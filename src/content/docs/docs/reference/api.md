---
title: API Reference
description: Call the Synclet API with curl or generated clients, authenticate with API keys, and find every public RPC with its required role.
---

Everything the Synclet UI does goes through a public [ConnectRPC](https://connectrpc.com/) API on the server's main port (`PUBLIC_HTTP_SERVER_ADDR`, `8080` by default). Scripts, CI jobs and integrations call the same API.

## Calling the API

Every RPC is an HTTP `POST` to `/<package>.<Service>/<Method>` with a JSON body:

```bash
curl -X POST https://synclet.example.com/synclet.publicapi.pipeline.v1.ConnectionService/ListConnections \
  -H "Authorization: Bearer $SYNCLET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

- The body is the request message in [protobuf JSON](https://protobuf.dev/programming-guides/json/): field names are camelCase (`connection_id` becomes `connectionId`), enums are their names (`"JOB_STATUS_FAILED"`), timestamps are RFC 3339 strings, and `int64` values come back as strings (`"lastId": "1042"`).
- Send `{}` when the request has no fields you need.
- A success is HTTP `200` with the response message as JSON.

The protos are the contract. They live in the Synclet repository under [`proto/synclet/publicapi/`](https://github.com/synclet-io/synclet/tree/main/proto/synclet/publicapi).

### Generated clients

The server speaks the Connect, gRPC and gRPC-Web protocols. To generate a typed client, copy the `proto/` directory from the Synclet repository and run `buf generate` with a `buf.gen.yaml` for your language. For Go:

```yaml
# buf.gen.yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen
    opt: paths=source_relative
  - remote: buf.build/connectrpc/go
    out: gen
    opt: paths=source_relative
```

```go
client := pipelinev1connect.NewJobServiceClient(http.DefaultClient, "https://synclet.example.com")

req := connect.NewRequest(&pipelinev1.TriggerSyncRequest{ConnectionId: connID})
req.Header().Set("Authorization", "Bearer "+os.Getenv("SYNCLET_API_KEY"))

resp, err := client.TriggerSync(ctx, req)
```

For TypeScript use `buf.build/bufbuild/es` with `@connectrpc/connect`; for other languages see the [Connect](https://connectrpc.com/docs/introduction) and [gRPC](https://grpc.io/docs/languages/) plugin lists.

Native gRPC needs HTTP/2. The server serves plain HTTP/1.1 unless TLS is on (`PUBLIC_HTTP_SERVER_TLS_ENABLED`, see [Environment Variables](/synclet-site/docs/reference/environment-variables/)), or unless an HTTP/2-capable proxy sits in front of it. The Connect protocol works over HTTP/1.1, so prefer a Connect client when in doubt.

To call a streaming RPC such as `DownloadJobLogs` without writing code, use [`buf curl`](https://buf.build/docs/reference/cli/buf/curl/) with the protos:

```bash
buf curl --schema ./proto --protocol connect \
  -H "Authorization: Bearer $SYNCLET_API_KEY" \
  -d '{"jobId": "<job-id>", "attempt": 1}' \
  https://synclet.example.com/synclet.publicapi.pipeline.v1.JobService/DownloadJobLogs
```

## Authentication

A request is authenticated by one of three credentials, checked in this order:

1. `Authorization: Bearer synclet_sk_…` is an **API key**.
2. Any other `Authorization: Bearer <token>` is a **user access token** (JWT).
3. With no `Authorization` header, the `synclet_at` **session cookie** is used.

A request with none of them, or with an unknown, expired or revoked credential, fails with `unauthenticated`.

### API keys

Create keys in **Settings > API Keys** ([Settings & API Keys](/synclet-site/docs/guides/settings/)). A key looks like `synclet_sk_` followed by 64 hex characters and is shown only once.

```
Authorization: Bearer synclet_sk_3f9c…
```

A key belongs to the workspace it was created in and acts as its creator with the creator's current role there. You don't send a workspace with an API key: the key's workspace is used and a `Workspace-Id` header is ignored. To work with several workspaces, create a key in each.

### Session cookies

The UI calls `AuthService/Login` (or completes OIDC sign-in), which sets three cookies:

| Cookie | Contents |
|---|---|
| `synclet_at` | Access token. `HttpOnly`. |
| `synclet_rt` | Refresh token, exchanged by `AuthService/RefreshToken`. `HttpOnly`. |
| `synclet_auth` | Expiry times only, readable by the UI's JavaScript. |

Login returns no token in its response body, so for scripts use an API key rather than a session.

### Workspace-Id header

A user session (cookie or JWT) isn't tied to a workspace. Workspace-scoped RPCs read the workspace from the `Workspace-Id` header, which carries the workspace UUID:

```
Workspace-Id: 4b0e6a52-0f7d-4c1e-9a43-6d1f0c2a9e11
```

Without it those RPCs fail with `permission_denied` ("workspace is required"). A value that isn't a UUID fails with `invalid_argument`.

### Roles

RPCs marked with a role in the tables below check the caller's role in the workspace: **Viewer** < **Editor** < **Admin**, and a higher role passes a lower check. A caller who isn't a member, or whose role is too low, gets `permission_denied`. See [Members](/synclet-site/docs/guides/settings/#members) for what each role is meant for.

## Errors

A failed call returns a non-200 status and a JSON body:

```json
{
  "code": "not_found",
  "message": "connection not found"
}
```

`code` is the stable part; `message` is for people and may change. Some errors add a `details` array.

| Code | HTTP | Typical cause |
|---|---|---|
| `unauthenticated` | 401 | No credential, or an invalid, expired or revoked key or token. |
| `permission_denied` | 403 | No workspace on a user session, not a member, or role too low. |
| `not_found` | 404 | The ID doesn't exist or belongs to another workspace. |
| `invalid_argument` | 400 | Malformed ID, missing or invalid field. Also "connection already has an active job" from `TriggerSync`. |
| `already_exists` | 409 | A resource with that name already exists. |
| `failed_precondition` | 400 | The resource is in use, the connector has no cached spec, or a workflow has an active run. |
| `resource_exhausted` | 429 | Rate limit exceeded (see below). |
| `internal` | 500 | Server-side failure. The details are in the server log, not the response. |

## Rate limiting

Only the unauthenticated auth endpoints are rate-limited, per client IP and per RPC ([`app/public_http_server_module.go`](https://github.com/synclet-io/synclet/blob/main/app/public_http_server_module.go), [`pkg/connectutil/rate_limiter.go`](https://github.com/synclet-io/synclet/blob/main/pkg/connectutil/rate_limiter.go)):

| RPC | Sustained rate | Burst |
|---|---|---|
| `AuthService/Login` | 1 per 6 s (~10/min) | 10 |
| `AuthService/Register` | 1 per 20 s (~3/min) | 3 |
| `AuthService/RefreshToken` | 1 per 3 s (~20/min) | 20 |
| `AuthService/RequestPasswordReset` | 1 per 6 s (~10/min) | 10 |
| `AuthService/ResetPassword` | 1 per 6 s (~10/min) | 10 |

Exceeding a limit returns `resource_exhausted`. Behind a reverse proxy, set `RATE_LIMIT_TRUSTED_PROXIES` so the limit applies to the real client IP from `X-Forwarded-For` instead of the proxy's. Other RPCs have no rate limit.

## Services

**Public** RPCs need no credential. **User** RPCs need a signed-in user but no workspace role. The other RPCs need the listed role in the workspace.

### AuthService

`synclet.publicapi.auth.v1.AuthService`

| RPC | Description | Access |
|---|---|---|
| `Register` | Create an account with email and password. | Public |
| `Login` | Sign in with email and password; sets session cookies. | Public |
| `RefreshToken` | Exchange the refresh cookie for a new access token. | Public |
| `Logout` | Clear the session cookies. | Public |
| `GetCurrentUser` | Return the signed-in user. | User |
| `UpdateProfile` | Change the user's name. | User |
| `ChangePassword` | Change the user's password. | User |
| `RequestPasswordReset` | Email a password reset link. | Public |
| `ResetPassword` | Set a new password with a reset token. | Public |
| `CreateAPIKey` | Create an API key in the current workspace; returns the raw key once. | Viewer |
| `RevokeAPIKey` | Revoke an API key. | Viewer |
| `ListAPIKeys` | List the workspace's API keys. | Viewer |
| `GetOIDCProviders` | List the configured OIDC sign-in providers. | Public |

### WorkspaceService

`synclet.publicapi.workspace.v1.WorkspaceService`

| RPC | Description | Access |
|---|---|---|
| `CreateWorkspace` | Create a workspace; the caller becomes its admin. | User |
| `UpdateWorkspace` | Rename the workspace. | Admin |
| `DeleteWorkspace` | Delete the workspace. | Admin |
| `GetWorkspace` | Get the workspace. | Viewer |
| `ListWorkspaces` | List the workspaces the user belongs to. | User |
| `RemoveMember` | Remove a member. | Admin |
| `UpdateMemberRole` | Change a member's role. | Admin |
| `ListMembers` | List members and their roles. | Viewer |
| `CreateInvite` | Invite someone by email. | Admin |
| `AcceptInvite` | Accept an invite as the signed-in user. | User |
| `DeclineInvite` | Decline an invite by token. | Public |
| `RevokeInvite` | Revoke a pending invite. | Admin |
| `ResendInvite` | Resend an invite email. | Admin |
| `ListInvites` | List pending invites. | Viewer |
| `GetInviteByToken` | Look up an invite from its link token. | Public |

### SourceService

`synclet.publicapi.pipeline.v1.SourceService`

| RPC | Description | Access |
|---|---|---|
| `CreateSource` | Create a source. | Editor |
| `UpdateSource` | Update a source's name or config. | Editor |
| `DeleteSource` | Delete a source. | Editor |
| `GetSource` | Get a source. | Viewer |
| `ListSources` | List the workspace's sources. | Viewer |
| `TestSourceConnection` | Start a connection check; returns a task ID. | Editor |
| `DiscoverSourceSchema` | Start schema discovery; returns a task ID. | Editor |
| `GetSourceCatalog` | Get the source's last discovered catalog. | Viewer |
| `GetSystemInfo` | Server capabilities: registration, workspaces mode, email. | Public |
| `GetRuntimeDefaults` | Default resource limits for connector containers. | Viewer |
| `ListExecutors` | Executors that reported to the control plane recently. | Viewer |

### DestinationService

`synclet.publicapi.pipeline.v1.DestinationService`

| RPC | Description | Access |
|---|---|---|
| `CreateDestination` | Create a destination. | Editor |
| `UpdateDestination` | Update a destination's name or config. | Editor |
| `DeleteDestination` | Delete a destination. | Editor |
| `GetDestination` | Get a destination. | Viewer |
| `ListDestinations` | List the workspace's destinations. | Viewer |
| `TestDestinationConnection` | Start a connection check; returns a task ID. | Editor |

### ConnectionService

`synclet.publicapi.pipeline.v1.ConnectionService`

| RPC | Description | Access |
|---|---|---|
| `CreateConnection` | Create a connection between a source and a destination. | Editor |
| `UpdateConnection` | Update schedule, namespace, retries, tags and other settings. A schedule on a connection that is a workflow step is rejected. | Editor |
| `DeleteConnection` | Delete a connection. Fails with `failed_precondition` while it is a workflow step. | Editor |
| `GetConnection` | Get a connection, with the workflows it is a step of in `workflows`. | Viewer |
| `ListConnections` | List connections, filtered by source, destination or tags. | Viewer |
| `ListConnectionTags` | List the tags in use with their connection counts. | Viewer |
| `EnableConnection` | Activate a connection's schedule. | Editor |
| `DisableConnection` | Deactivate a connection. | Editor |
| `DiscoverSchema` | Start schema discovery for the connection's source. | Editor |
| `ConfigureStreams` | Save the selected streams, sync modes and mappers. | Editor |
| `GetDiscoveredCatalog` | Get the latest discovered catalog. | Viewer |
| `GetConfiguredCatalog` | Get the saved stream configuration. | Viewer |
| `ValidateMappers` | Compile unsaved mappers, optionally against a sample record. | Viewer |
| `GetSchemaChanges` | Diff the configured catalog against the latest discovered one. | Viewer |
| `ResetStreamState` | Reset the state of one stream. | Editor |
| `ResetConnectionState` | Reset the state of all streams. | Editor |
| `ListStreamStates` | List per-stream state. | Viewer |
| `UpdateStreamState` | Overwrite one stream's state. | Editor |
| `ExportWorkspaceConfig` | Export the workspace's sources, destinations and connections. | Admin |
| `ImportWorkspaceConfig` | Import an exported configuration. | Admin |
| `GetPipelineSettings` | Get workspace pipeline settings. | Viewer |
| `UpdatePipelineSettings` | Update workspace pipeline settings. | Admin |

### JobService

`synclet.publicapi.pipeline.v1.JobService`

| RPC | Description | Access |
|---|---|---|
| `TriggerSync` | Queue a sync job for a connection. | Editor |
| `CancelJob` | Cancel a scheduled or running job. | Editor |
| `GetJob` | Get a job with its attempts. | Viewer |
| `ListJobs` | List jobs, filtered by connection and status. | Viewer |
| `GetJobLogs` | Read a job's log lines from a cursor. | Viewer |
| `DownloadJobLogs` | Stream the full log of one attempt as plain text (server streaming). | Viewer |

### WorkflowService

`synclet.publicapi.pipeline.v1.WorkflowService`

| RPC | Description | Access |
|---|---|---|
| `CreateWorkflow` | Create a workflow from a name, an optional cron `schedule` and its steps. | Editor |
| `UpdateWorkflow` | Replace a workflow's name, schedule and steps. | Editor |
| `DeleteWorkflow` | Delete a workflow and its runs. | Editor |
| `GetWorkflow` | Get a workflow with its steps. | Viewer |
| `ListWorkflows` | List the workspace's workflows. | Viewer |
| `RunWorkflow` | Start a run now (trigger `manual`). | Editor |
| `RerunWorkflowRun` | Rerun a failed run from its failed and skipped steps. | Editor |
| `ListWorkflowRuns` | List a workflow's runs with their step runs. | Viewer |
| `GetWorkflowRun` | Get one run with its step runs. | Viewer |

A step is `{"connectionId": "…", "afterConnectionIds": ["…"]}`: it runs after the steps of the listed connections. A cycle, a connection listed twice or a connection of another workspace is `invalid_argument`. `UpdateWorkflow`, `DeleteWorkflow` and `RunWorkflow` fail with `failed_precondition` while a run is active, and `RerunWorkflowRun` also for a run that did not fail. See [Workflows](/synclet-site/docs/guides/workflows/).

### ConnectorTaskService

`synclet.publicapi.pipeline.v1.ConnectorTaskService`

| RPC | Description | Access |
|---|---|---|
| `GetConnectorTaskResult` | Get the status and result of a check, spec or discover task. | Viewer |

### ConnectorRegistryService

`synclet.publicapi.registry.v1.ConnectorRegistryService`

| RPC | Description | Access |
|---|---|---|
| `ListConnectors` | List connectors available from the registries. | Viewer |
| `GetConnectorSpec` | Get a connector's configuration spec. | Viewer |
| `AddConnector` | Add a connector to the workspace. | Editor |
| `GetManagedConnector` | Get a connector added to the workspace. | Viewer |
| `ListManagedConnectors` | List the workspace's connectors. | Viewer |
| `DeleteManagedConnector` | Remove a connector from the workspace. | Editor |
| `StarManagedConnector` | Star a connector. | Editor |
| `UnstarManagedConnector` | Unstar a connector. | Editor |
| `AddRepository` | Add a connector repository. | Admin |
| `ListRepositories` | List connector repositories. | Viewer |
| `DeleteRepository` | Remove a connector repository. | Admin |
| `SyncRepository` | Refresh a repository's connector list. | Admin |
| `ListRepositoryConnectors` | List the connectors in a repository. | Viewer |
| `GetConnectorVersions` | List the available versions of a connector image. | Viewer |
| `UpdateManagedConnector` | Update a connector to the latest version in its repository. | Editor |
| `BatchUpdateConnectors` | Update several connectors to their latest versions. | Editor |

### StatsService

`synclet.publicapi.stats.v1.StatsService`

| RPC | Description | Access |
|---|---|---|
| `GetWorkspaceStats` | Workspace sync totals for a time range. | Viewer |
| `GetConnectionStats` | Sync totals for one connection. | Viewer |
| `GetSyncTimeline` | Sync activity over time for the workspace or one connection. | Viewer |

### NotificationService

`synclet.publicapi.notify.v1.NotificationService`

| RPC | Description | Access |
|---|---|---|
| `CreateNotificationChannel` | Create a Slack, email or Telegram channel. | Admin |
| `UpdateNotificationChannel` | Update a channel. | Admin |
| `DeleteNotificationChannel` | Delete a channel. | Admin |
| `ListNotificationChannels` | List channels. | Viewer |
| `TestNotificationChannel` | Send a test notification. | Admin |
| `CreateNotificationRule` | Create a rule that routes events to a channel. | Editor |
| `UpdateNotificationRule` | Update a rule. | Editor |
| `DeleteNotificationRule` | Delete a rule. | Editor |
| `ListNotificationRules` | List rules. | Viewer |

### WebhookService

`synclet.publicapi.webhook.v1.WebhookService`

| RPC | Description | Access |
|---|---|---|
| `CreateWebhook` | Create a webhook. | Admin |
| `UpdateWebhook` | Update a webhook. | Admin |
| `DeleteWebhook` | Delete a webhook. | Admin |
| `ListWebhooks` | List webhooks. | Admin |
| `TestWebhook` | Send a test delivery. | Admin |

### AuditService

`synclet.publicapi.audit.v1.AuditService`

| RPC | Description | Access |
|---|---|---|
| `ListAuditEvents` | List audit events. | Admin |
| `GetAuditEvent` | Get one audit event with its before/after values. | Admin |
| `GetAuditRetention` | Get the audit log retention period. | Admin |
| `UpdateAuditRetention` | Set the audit log retention period. | Admin |

## Examples

The examples use `jq` and these variables:

```bash
export SYNCLET_URL=https://synclet.example.com
export SYNCLET_API_KEY=synclet_sk_...

sapi() {
  curl -sS -X POST "$SYNCLET_URL/synclet.publicapi.$1" \
    -H "Authorization: Bearer $SYNCLET_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$2"
}
```

### List connections

```bash
sapi pipeline.v1.ConnectionService/ListConnections '{"pageSize": 50, "tags": ["prod"]}' \
  | jq -r '.connections[] | [.id, .name, .status, .sourceName, .destinationName] | @tsv'
```

`ListConnections` pages with `pageSize` and `offset`; `total` is the full count.

### Trigger a sync and wait for it

```bash
JOB_ID=$(sapi pipeline.v1.JobService/TriggerSync "{\"connectionId\": \"$CONNECTION_ID\"}" | jq -r '.job.id')

while :; do
  STATUS=$(sapi pipeline.v1.JobService/GetJob "{\"jobId\": \"$JOB_ID\"}" | jq -r '.job.status')
  echo "$STATUS"
  case "$STATUS" in
    JOB_STATUS_COMPLETED) exit 0 ;;
    JOB_STATUS_FAILED|JOB_STATUS_CANCELLED) exit 1 ;;
  esac
  sleep 10
done
```

A job moves through `JOB_STATUS_SCHEDULED`, `JOB_STATUS_STARTING` and `JOB_STATUS_RUNNING` to `JOB_STATUS_COMPLETED`, `JOB_STATUS_FAILED` or `JOB_STATUS_CANCELLED`. A connection has at most one active job: triggering while one is scheduled or running returns `invalid_argument`. On failure, `.job.error` and `.job.attempts[].error` hold the reasons.

### Read job logs

`GetJobLogs` returns lines after a cursor. Pass `lastId` back as `afterId` until `hasMore` is false:

```bash
AFTER=0
while :; do
  RESP=$(sapi pipeline.v1.JobService/GetJobLogs "{\"jobId\": \"$JOB_ID\", \"afterId\": \"$AFTER\", \"limit\": 1000}")
  echo "$RESP" | jq -r '.lines[]?'
  [ "$(echo "$RESP" | jq -r '.hasMore // false')" = "true" ] || break
  AFTER=$(echo "$RESP" | jq -r '.lastId')
done
```

`limit` is capped at 5000. While the job runs, keep polling with the last cursor to tail new lines. For the complete log of one attempt as plain text, use `DownloadJobLogs` (see [Generated clients](#generated-clients)).

### List recent failed jobs

```bash
sapi pipeline.v1.JobService/ListJobs '{"statuses": ["JOB_STATUS_FAILED"], "pageSize": 20}' \
  | jq -r '.jobs[] | [.completedAt, .connectionId, .error] | @tsv'
```

Leave out `connectionId` to list the whole workspace, or set it to list one connection. `pageSize` is capped at 100.

## Internal API

The server also serves an internal API on port `8081` (`INTERNAL_HTTP_SERVER_ADDR`) for executors; it is not a public API and is not covered here.
