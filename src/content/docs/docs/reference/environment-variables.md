---
title: Environment Variables
description: Every environment variable Synclet reads, grouped by area, with defaults.
---

Synclet is configured entirely through environment variables. Set them in your shell, a `.env` file, Docker Compose, or Kubernetes Secrets. Every command also accepts `--dotenv <file>` (repeatable) to load environment files first.

:::tip
`synclet generate dotenv` appends every variable the binary reads, with its default, to `.env` (or the first `--dotenv` file). Variables already set in that file are left alone; variables without a default are written commented out.
:::

## Required

| Variable | Description | Default |
|---|---|---|
| `DB_DSN` | PostgreSQL connection string. Example: `postgres://user:pass@host:5432/synclet?sslmode=require` | *required* |
| `AUTH_JWT_SECRET` | Token-signing secret, at least 32 characters. | *required outside local development* |
| `SECRET_ENCRYPTION_KEY` | Base64-encoded 32-byte AES key for stored connector credentials. Back it up: stored secrets cannot be decrypted without it. | *required outside local development* |

Synclet generates the two secrets only for local development: `ENVIRONMENT` unset or `development`, outside a container. There it creates an ephemeral `AUTH_JWT_SECRET` (sessions end on every restart) and persists an encryption key to `<UserConfigDir>/synclet/encryption.key`, logging a warning for each. Anywhere else, including a container or a Kubernetes pod, the process refuses to start until both are set.

Generate them with:

```bash
openssl rand -base64 32   # AUTH_JWT_SECRET
openssl rand -base64 32   # SECRET_ENCRYPTION_KEY
```

## General

| Variable | Description | Default |
|---|---|---|
| `ENVIRONMENT` | Runtime environment: `development`, `production` or `test`. `development` allows generated secrets and `migrate down` without `--yes`. | `development` |
| `LOG_LEVEL` | Log level. | `info` |

## HTTP Servers

Synclet listens on two ports: the public server (UI and API) and the internal server (executor API and the `/live`, `/ready` probes). Each takes the same set of variables with the prefix `PUBLIC_HTTP_SERVER_` or `INTERNAL_HTTP_SERVER_`.

| Variable | Description | Default |
|---|---|---|
| `PUBLIC_HTTP_SERVER_ADDR` | Public UI and API listen address. | `0.0.0.0:8080` |
| `INTERNAL_HTTP_SERVER_ADDR` | Executor API and probe listen address. Must differ from the public one. | `0.0.0.0:8081` |
| `*_READ_TIMEOUT` | Maximum time to read a request; `0s` means no limit. | `0s` |
| `*_READ_HEADER_TIMEOUT` | Maximum time to read request headers. | `10s` |
| `*_WRITE_TIMEOUT` | Maximum time to write a response; `0s` means no limit. | `0s` |
| `*_IDLE_TIMEOUT` | Keep-alive idle timeout. | `120s` |
| `*_TLS_ENABLED` | Serve TLS on this port. | `false` |
| `*_TLS_CERT_PATH`, `*_TLS_KEY_PATH` | Certificate and key files. | *empty* |
| `*_TLS_CLIENT_AUTH`, `*_TLS_CLIENT_CA_PATH` | Client certificate verification mode and CA bundle. | *empty* |
| `*_TLS_APPEND_SYSTEM_CAS_TO_CLIENT` | Trust the system CAs in addition to the client CA bundle. | `false` |
| `RATE_LIMIT_TRUSTED_PROXIES` | Comma-separated IPs or CIDR ranges of reverse proxies whose `X-Forwarded-For` and `X-Real-IP` headers identify the client for the login and register rate limits. | *empty* |

### CORS (public server)

| Variable | Description | Default |
|---|---|---|
| `PUBLIC_HTTP_SERVER_CORS_ALLOWED_ORIGINS` | Comma-separated hostnames whose browser origins may call the API. | *empty* |
| `PUBLIC_HTTP_SERVER_CORS_ALLOWED_ORIGIN_GLOBS` | Origin patterns, for example `*.example.com`. | *empty* |
| `PUBLIC_HTTP_SERVER_CORS_ALLOW_ALL_ORIGINS` | Allow any origin. | `false` |
| `PUBLIC_HTTP_SERVER_CORS_ALLOWED_METHODS` | Allowed methods. | *empty* |
| `PUBLIC_HTTP_SERVER_CORS_ALLOWED_HEADERS` | Allowed request headers. | `*` |
| `PUBLIC_HTTP_SERVER_CORS_EXPOSED_HEADERS` | Response headers exposed to the browser. | *empty* |
| `PUBLIC_HTTP_SERVER_CORS_ALLOW_CREDENTIALS` | Allow cookies and credentials. | `false` |
| `PUBLIC_HTTP_SERVER_CORS_ALLOW_PRIVATE_NETWORK` | Answer private network access preflights. | `false` |
| `PUBLIC_HTTP_SERVER_CORS_MAX_AGE` | Preflight cache lifetime in seconds. | `0` |

## Authentication

| Variable | Description | Default |
|---|---|---|
| `AUTH_REGISTRATION_ENABLED` | Allow email/password sign-up. Set to `false` after creating your admin account. | `true` |
| `AUTH_SECURE_COOKIES` | Mark authentication cookies HTTPS-only. Set to `true` behind HTTPS. | `false` |
| `AUTH_ACCESS_TOKEN_TTL` | Lifetime of access tokens. | `15m` |
| `AUTH_REFRESH_TOKEN_TTL` | Lifetime of refresh tokens. | `168h` |
| `AUTH_MIN_PASSWORD_LENGTH` | Minimum length for new passwords. | `8` |
| `AUTH_PASSWORD_RESET_COOLDOWN` | Minimum time between two password reset emails for one user. | `2m` |
| `AUTH_TOKEN_CLEANUP_INTERVAL` | How often expired tokens are deleted. | `1h` |
| `AUTH_OIDC_STATE_TTL` | How long an OIDC login may take between redirect and callback. | `10m` |
| `AUTH_OIDC_PROVIDERS` | Comma-separated OIDC provider slugs; see [OIDC Providers](#oidc-providers). | *empty* |
| `AUTH_OIDC_CALLBACK_BASE_URL` | Base URL for OIDC callbacks. | *empty* |

## Workspaces

| Variable | Description | Default |
|---|---|---|
| `WORKSPACE_MODE` | `single` creates one default workspace and auto-joins every user to it. `multi` allows multiple workspaces with explicit membership. | `single` |
| `WORKSPACE_INVITE_TTL` | How long workspace invitation links remain valid. | `168h` |
| `WORKSPACE_FRONTEND_URL` | Public URL of the UI, used in invite and password reset links. | `http://localhost:5173` |

## Audit Log

| Variable | Description | Default |
|---|---|---|
| `AUDIT_RETENTION_DAYS` | Default number of days audit events are kept. At least `1`. | `90` |
| `AUDIT_RETENTION_MAX_DAYS` | Upper bound a workspace may set for its own retention. Not lower than `AUDIT_RETENTION_DAYS`. | `365` |
| `AUDIT_RETENTION_CLEANUP_INTERVAL` | How often expired audit events are deleted. | `1h` |

## Email and Webhooks

Email is disabled while `NOTIFY_SMTP_HOST` is empty; the "Forgot password?" link is hidden then too.

| Variable | Description | Default |
|---|---|---|
| `NOTIFY_SMTP_HOST` | SMTP server hostname. | *empty* |
| `NOTIFY_SMTP_PORT` | SMTP server port. Port `587` usually needs `NOTIFY_SMTP_TLS=starttls`. | `465` |
| `NOTIFY_SMTP_TLS` | `implicit` (TLS from the first byte), `starttls`, or `none` (plain text, for local catchers such as Mailpit). | `implicit` |
| `NOTIFY_SMTP_USER` | SMTP username. | *empty* |
| `NOTIFY_SMTP_PASSWORD` | SMTP password. | *empty* |
| `NOTIFY_SMTP_FROM` | Sender address. | `noreply@synclet.io` |
| `NOTIFY_WEBHOOK_HTTP_TIMEOUT` | Timeout of one webhook delivery. | `10s` |
| `NOTIFY_WEBHOOK_MAX_RETRIES` | Total delivery attempts per webhook event, with 1s, 2s, … waits between them. | `3` |

## Sync Pipeline

| Variable | Description | Default |
|---|---|---|
| `PIPELINE_MAX_CONCURRENT_JOBS` | Sync jobs the scheduler runs at once. | `10` |
| `PIPELINE_IDLE_TIMEOUT` | Cancel a sync that receives no records for this long. | `10m` |
| `PIPELINE_DEFAULT_MAX_ATTEMPTS` | Attempts per sync job before it fails. | `3` |
| `PIPELINE_HEARTBEAT_TIMEOUT` | A running job without a heartbeat for this long is treated as lost. | `30s` |
| `PIPELINE_EXECUTOR_SILENCE_TIMEOUT` | How long an executor stays listed after its last registration heartbeat. | `60s` |
| `PIPELINE_CONNECTION_CHECK_TIMEOUT` | Timeout of a connection check. | `2m` |
| `PIPELINE_REGISTRY_FETCH_TIMEOUT` | Timeout for fetching a connector registry. | `60s` |
| `PIPELINE_EVENT_EMIT_TIMEOUT` | Timeout for publishing a pipeline event. | `30s` |
| `PIPELINE_EXECUTOR_API_TOKEN` | Token the internal server requires from executors. Executors present it as `EXECUTOR_API_TOKEN`. | *empty* |
| `PIPELINE_CONNECTOR_TASK_RETENTION` | How long finished check, spec and discover results are kept. | `24h` |
| `PIPELINE_CONNECTOR_TASK_RUNNING_TIMEOUT` | Timeout of a running connector task (check, spec, discover). | `5m` |
| `PIPELINE_CONNECTOR_TASK_PENDING_TIMEOUT` | Timeout of a connector task that has not started. | `1m` |
| `PIPELINE_CONNECTOR_TASK_POLL_INTERVAL` | How often a waiting request polls its connector task. | `500ms` |
| `PIPELINE_STATS_ROLLUP_HOURLY_LOOKBACK` | Window the hourly statistics rollup recomputes. | `2h` |
| `PIPELINE_STATS_ROLLUP_DAILY_LOOKBACK` | Window the daily statistics rollup recomputes. | `48h` |

### Background job intervals

| Variable | Description | Default |
|---|---|---|
| `PIPELINE_JOB_SCHEDULER_INTERVAL` | How often due connections are scheduled. | `30s` |
| `PIPELINE_JOB_WATCHDOG_INTERVAL` | How often jobs without a heartbeat are looked for. | `10s` |
| `PIPELINE_JOB_RETENTION_INTERVAL` | How often old jobs are deleted. | `10m` |
| `PIPELINE_JOB_STATS_ROLLUP_INTERVAL` | How often statistics are rolled up. | `5m` |
| `PIPELINE_JOB_REPOSITORY_SYNC_INTERVAL` | How often connector repositories are refreshed. | `1h` |
| `PIPELINE_JOB_CONNECTOR_TASK_RETENTION_INTERVAL` | How often old connector tasks are deleted. | `5m` |
| `PIPELINE_JOB_STALE_CONNECTOR_TASK_WATCHDOG_INTERVAL` | How often stuck connector tasks are failed. | `5m` |

### Connector resources

Defaults for connector containers and pods. A source or destination overrides them in its runtime config.

| Variable | Description | Default |
|---|---|---|
| `PIPELINE_RUNTIME_CPU_REQUEST` | CPU request. | *empty* |
| `PIPELINE_RUNTIME_CPU_LIMIT` | CPU limit. | *empty* |
| `PIPELINE_RUNTIME_MEMORY_REQUEST` | Memory request. | *empty* |
| `PIPELINE_RUNTIME_MEMORY_LIMIT` | Memory limit. | *empty* |
| `PIPELINE_RUNTIME_SERVICE_ACCOUNT_NAME` | Kubernetes service account of connector pods; empty uses the namespace's default account. See [Kubernetes: service accounts](/docs/deployment/kubernetes/#service-accounts). | *empty* |

## Job Logs

See [Monitoring: log storage](/docs/guides/monitoring/#log-storage-and-archiving) for how archiving works.

| Variable | Description | Default |
|---|---|---|
| `PIPELINE_LOG_MAX_LINES_PER_ATTEMPT` | Log lines stored per job attempt; later lines are dropped and counted. `0` disables the cap. | `100000` |
| `PIPELINE_LOG_ARCHIVE_BACKEND` | Where logs of finished jobs go: `none` (stay in PostgreSQL), `filesystem`, `s3` or `gcs`. | `none` |
| `PIPELINE_LOG_ARCHIVE_DIR` | Base directory for `filesystem`. Every server replica must see the same directory. | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_ENDPOINT` | S3 endpoint; set it for anything but AWS (MinIO, R2, GCS interoperability, Garage). | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_REGION` | Bucket region. | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_BUCKET` | Bucket name. | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_PREFIX` | Key prefix inside the bucket. | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_ACCESS_KEY_ID`, `PIPELINE_LOG_ARCHIVE_S3_SECRET_ACCESS_KEY` | Static keys; without them the default AWS credential chain is used (environment, IRSA, instance profile). | *empty* |
| `PIPELINE_LOG_ARCHIVE_S3_USE_PATH_STYLE` | Path-style addressing, needed for MinIO and Garage. | `false` |
| `PIPELINE_LOG_ARCHIVE_GCS_BUCKET` | Bucket name. | *empty* |
| `PIPELINE_LOG_ARCHIVE_GCS_PREFIX` | Object prefix inside the bucket. | *empty* |
| `PIPELINE_LOG_ARCHIVE_GCS_CREDENTIALS_FILE` | Service account key file; without it, Application Default Credentials (GKE Workload Identity, `GOOGLE_APPLICATION_CREDENTIALS`, `gcloud auth application-default login`). | *empty* |

## OIDC Providers

Configure one or more OIDC providers for single sign-on. Set `AUTH_OIDC_PROVIDERS` to a comma-separated list of provider slugs, then configure each provider with `AUTH_OIDC_<SLUG>_*` variables.

| Variable | Description |
|---|---|
| `AUTH_OIDC_PROVIDERS` | Comma-separated list of provider slugs (e.g., `google,okta`). Required to enable OIDC. |
| `AUTH_OIDC_CALLBACK_BASE_URL` | Base URL for OIDC callback redirects. Required when `AUTH_OIDC_PROVIDERS` is set. |
| `AUTH_OIDC_<SLUG>_ISSUER` | OIDC issuer URL (e.g., `https://accounts.google.com`). |
| `AUTH_OIDC_<SLUG>_CLIENT_ID` | OAuth client ID from your identity provider. |
| `AUTH_OIDC_<SLUG>_CLIENT_SECRET` | OAuth client secret. |
| `AUTH_OIDC_<SLUG>_DISPLAY_NAME` | Human-readable name shown in the UI. Defaults to the slug. |
| `AUTH_OIDC_<SLUG>_SCOPES` | Comma-separated list of OIDC scopes. Default: `openid,profile,email`. |
| `AUTH_OIDC_<SLUG>_DEFAULT_ROLE` | Role in the default workspace when the role claim matches no mapping: `admin`, `editor` or `viewer`. Single-workspace mode only. Default: `viewer`. |
| `AUTH_OIDC_<SLUG>_AUTO_CREATE_USER` | Auto-create users on first login. Default: `true`. |
| `AUTH_OIDC_<SLUG>_ALLOWED_DOMAINS` | Comma-separated list of allowed email domains. |
| `AUTH_OIDC_<SLUG>_ROLE_CLAIM` | OIDC claim to use for role mapping (e.g., `groups`). |
| `AUTH_OIDC_<SLUG>_ROLE_MAP_ADMIN` | Claim value that maps to the Admin role. |
| `AUTH_OIDC_<SLUG>_ROLE_MAP_EDITOR` | Claim value that maps to the Editor role. |
| `AUTH_OIDC_<SLUG>_ROLE_MAP_VIEWER` | Claim value that maps to the Viewer role. |
| `AUTH_OIDC_<SLUG>_ROLE_SYNC` | When the role claim is applied to an existing member of the default workspace: `login` (every login, overwriting roles changed in the UI) or `first_login` (only when the user joins). Default: `login`. |
| `AUTH_OIDC_<SLUG>_BOUND_CLAIM_<NAME>` | Require a specific claim value for authentication (e.g., `AUTH_OIDC_OKTA_BOUND_CLAIM_DEPARTMENT=engineering`). |

### Example: Google

```bash
export AUTH_OIDC_PROVIDERS="google"
export AUTH_OIDC_CALLBACK_BASE_URL="https://synclet.example.com"
export AUTH_OIDC_GOOGLE_CLIENT_ID="123456.apps.googleusercontent.com"
export AUTH_OIDC_GOOGLE_CLIENT_SECRET="GOCSPX-abc123"
export AUTH_OIDC_GOOGLE_ISSUER="https://accounts.google.com"
```

You can configure multiple providers by adding slugs to `AUTH_OIDC_PROVIDERS` (e.g., `google,okta`) and setting the corresponding `AUTH_OIDC_<SLUG>_*` variables for each.

The role variables (`ROLE_CLAIM`, `ROLE_MAP_*`, `DEFAULT_ROLE`, `ROLE_SYNC`) set the user's role in the default workspace and apply in single-workspace mode only; in multi-workspace mode the server ignores them and logs a warning. See [Role mapping](/docs/guides/authentication/#role-mapping) for an authentik `groups` example.

## Docker Executor

| Variable | Description | Default |
|---|---|---|
| `DOCKER_EXECUTOR_MAX_CONCURRENT_JOBS` | Sync jobs one Docker executor runs at once. | `5` |
| `DOCKER_EXECUTOR_MAX_SYNC_DURATION` | Maximum run time of one sync. | `24h` |
| `DOCKER_EXECUTOR_JOB_WORKER_INTERVAL` | How often the executor polls for pending work. | `1s` |
| `DOCKER_EXECUTOR_HEARTBEAT_INTERVAL` | How often a running sync sends a heartbeat. | `5s` |
| `DOCKER_EXECUTOR_JOB_RESOURCE_CLEANUP_INTERVAL` | How often orphaned containers are removed. | `5m` |
| `DOCKER_EXECUTOR_TEMP_DIR_ROOT` | Scratch directory for connector config, catalog and state. Leave empty when running the binary natively (the OS temp dir is used). When Synclet runs in a container that talks to the host `docker.sock`, set it to a host-bind-mounted path that is identical inside and outside the container. | *empty* |
| `DOCKER_EXECUTOR_OWNER_ID` | Executor ID, stamped as the `synclet.io/owner` label on every connector container; orphan cleanup removes only containers carrying it. Executors sharing one Docker daemon need distinct values. | hostname |
| `DOCKER_EXECUTOR_LOCAL_ROOT` | Host directory mounted at `/local` in every connector container, where [file-writing destinations](/docs/concepts/connectors/#files-written-by-destinations) leave their files. Shared by all jobs and never cleaned. Empty gives each job its own `/local`, removed with the job. Like `DOCKER_EXECUTOR_TEMP_DIR_ROOT`, a containerised Synclet needs it mounted at the same path from the host. | *empty* |

## Kubernetes Executor

Used by `synclet k8s-executor`, and by `synclet server --standalone` inside a pod.

| Variable | Description | Default |
|---|---|---|
| `K8S_EXECUTOR_NAMESPACE` | Namespace for connector pods. | *empty* |
| `K8S_EXECUTOR_KUBECONFIG` | Kubeconfig path; empty uses the in-cluster config. | *empty* |
| `K8S_EXECUTOR_IMAGE_PULL_SECRET` | Image pull secret for private registries. | *empty* |
| `K8S_EXECUTOR_LOCAL_VOLUME_CLAIM` | Existing PersistentVolumeClaim mounted at `/local` in the connector containers, where [file-writing destinations](/docs/concepts/connectors/#files-written-by-destinations) leave their files (Helm: `k8s.localVolume`). Empty mounts a per-pod `emptyDir`. | *empty* |
| `K8S_EXECUTOR_SYNCLET_IMAGE` | Synclet image of the orchestrator container in sync pods. | *empty* |
| `K8S_EXECUTOR_SERVER_ADDR` | Internal server address the orchestrator containers call. | *empty* |
| `K8S_EXECUTOR_DEFAULT_MEMORY` | Default memory of sync pods. | `2Gi` |
| `K8S_EXECUTOR_DEFAULT_CPU` | Default CPU of sync pods. | `1` |
| `K8S_EXECUTOR_JOB_WORKER_INTERVAL` | How often the executor polls for pending work. | `5s` |
| `K8S_EXECUTOR_JOB_RESOURCE_CLEANUP_INTERVAL` | How often orphaned pods are removed. | `5m` |
| `K8S_EXECUTOR_OWNER_ID` | Executor ID, stamped as the `synclet.io/owner` label on every Job and Secret the executor creates; it reconciles only those carrying it. Executors sharing one namespace need distinct values. | hostname |

## Distributed Mode

`synclet docker-executor` and `synclet k8s-executor` never open the database: they reach the server over the internal API.

| Variable | Description | Default |
|---|---|---|
| `EXECUTOR_API_URL` | Internal server URL. | *empty* |
| `EXECUTOR_API_TOKEN` | Token the executor presents; must match the server's `PIPELINE_EXECUTOR_API_TOKEN`. | *empty* |
| `EXECUTOR_REGISTRATION_INTERVAL` | How often an executor reports itself (ID, type, version, capacity) to the server's executor registry. | `15s` |

## Event Bus

| Variable | Description | Default |
|---|---|---|
| `WATERMILL_TRANSPORT` | Transport of the transactional outbox. `sql` reuses PostgreSQL via `DB_DSN`. | `sql` |
| `WATERMILL_SQL_DRIVER` | SQL driver for the `sql` transport. | `postgres` |
| `WATERMILL_SQL_CONSUMER_GROUP` | Consumer group of the `sql` transport. | `synclet` |
| `WATERMILL_TOPICS_PREFIX` | Prefix added to every topic name. | *empty* |
| `WATERMILL_REDIS_CONSUMER_GROUP` | Consumer group of the `redis` transport. | *empty* |
| `WATERMILL_GCLOUD_PUB_SUB_PROJECT_ID`, `WATERMILL_GCLOUD_PUB_SUB_SUBSCRIPTION_NAME_PREFIX` | Project and subscription prefix of the Google Cloud Pub/Sub transport. | *empty* |
| `EVENTS_RETRY_MAX_RETRIES` | Retries of a failed event handler. | `5` |
| `EVENTS_RETRY_INITIAL_INTERVAL` | First retry delay. | `1s` |
| `EVENTS_RETRY_MAX_INTERVAL` | Longest retry delay. | `1m` |

## Secret Rotation

| Variable | Description | Default |
|---|---|---|
| `SECRET_ENCRYPTION_KEY_PREVIOUS` | Previous encryption key, kept during key rotation. Synclet decrypts credentials encrypted with it and re-encrypts them with the current key. | *empty* |

**Security notes:**

- Never commit secrets to version control.
- Use a secret manager (HashiCorp Vault, AWS Secrets Manager, Kubernetes Secrets, Doppler) in production.
- After rotating `AUTH_JWT_SECRET`, all users sign in again. After rotating `SECRET_ENCRYPTION_KEY`, set the old key as `SECRET_ENCRYPTION_KEY_PREVIOUS` so existing credentials are re-encrypted.
