---
title: Executors
description: Standalone and distributed mode, the Docker and Kubernetes executors, the executor API and its token, owner IDs and scaling.
---

An executor claims sync jobs and connector tasks (spec, check, discover) and runs the connectors. Synclet has two: the **Docker executor** starts connector containers on a Docker daemon, and the **Kubernetes executor** launches each sync and connector task as a Kubernetes Job.

## Standalone and distributed

Synclet is one binary with several commands:

| Command | Runs | Database |
|---|---|---|
| `synclet server --standalone` | Public API and UI, internal API, background jobs (scheduler, heartbeat watchdog, retention), event consumers and an embedded executor | Yes |
| `synclet server` | Public API and UI, internal API | Yes |
| `synclet jobs` | Background jobs and event consumers | Yes |
| `synclet docker-executor` | Docker executor | No |
| `synclet k8s-executor` | Kubernetes executor | No |

**Standalone** is one `server --standalone` process. Its embedded executor talks to the rest of the process directly. It picks the Kubernetes executor when it runs in a pod (`KUBERNETES_SERVICE_HOST` is set) and the Docker executor otherwise.

**Distributed** splits the same work: one or more `synclet server` replicas for the API, `synclet jobs` for the background work, and one or more executors. An executor never opens the database: it claims work, reports progress and sends logs through the server's internal API.

The Helm chart runs both layouts (`mode: standalone` or `mode: distributed`), see [Kubernetes](/synclet-site/docs/deployment/kubernetes/#standalone-vs-distributed). Docker Compose runs standalone.

## Docker vs Kubernetes executor

| | Docker executor | Kubernetes executor |
|---|---|---|
| Runs connectors as | Containers on the Docker daemon behind its socket | One Kubernetes Job per sync (orchestrator, source and destination containers) or connector task, in `K8S_EXECUTOR_NAMESPACE` |
| Concurrency | `DOCKER_EXECUTOR_MAX_CONCURRENT_JOBS` syncs per executor (default `5`); it claims a job only when it has a free slot | No limit of its own; it claims a job every `K8S_EXECUTOR_JOB_WORKER_INTERVAL` and leaves scheduling to the cluster |
| Sync time limit | `DOCKER_EXECUTOR_MAX_SYNC_DURATION` | None |
| Heartbeat of a running sync | Every `DOCKER_EXECUTOR_HEARTBEAT_INTERVAL` (default `5s`), sent by the executor | Every 10 seconds, sent by the orchestrator container of the sync pod |
| Resource defaults | `PIPELINE_RUNTIME_*` | `PIPELINE_RUNTIME_*`, else `K8S_EXECUTOR_DEFAULT_CPU` and `K8S_EXECUTOR_DEFAULT_MEMORY` |
| Cleanup | Removes its orphaned containers at startup and every `DOCKER_EXECUTOR_JOB_RESOURCE_CLEANUP_INTERVAL` | Reconciles its Jobs and Secrets every `K8S_EXECUTOR_JOB_RESOURCE_CLEANUP_INTERVAL`: deletes those of finished or cancelled jobs and fails syncs whose pod crashed or cannot pull its image |

The sync pods of the Kubernetes executor call the internal API themselves, at `K8S_EXECUTOR_SERVER_ADDR`, with the executor's token.

All variables are listed in [Environment Variables](/synclet-site/docs/reference/environment-variables/#docker-executor).

## The internal API

Every `synclet server`, standalone or not, serves an internal HTTP server on `INTERNAL_HTTP_SERVER_ADDR` (`0.0.0.0:8081` by default). It carries:

- the executor API, which executors and Kubernetes sync pods call;
- `/live`, `/ready` and `/metrics`.

`synclet jobs` and both executor commands serve the probes and metrics on the same port, but not the executor API.

Every executor API request carries the token in the `X-Internal-Secret` header. The server compares it with `PIPELINE_EXECUTOR_API_TOKEN` and rejects the request when they differ, and every request while `PIPELINE_EXECUTOR_API_TOKEN` is empty. An executor sends `EXECUTOR_API_TOKEN` to `EXECUTOR_API_URL`:

```bash
# server
PIPELINE_EXECUTOR_API_TOKEN=<token>

# executor
EXECUTOR_API_URL=http://synclet-internal:8081
EXECUTOR_API_TOKEN=<same token>
```

Generate the token with `openssl rand -base64 32`. A standalone server with the Docker executor needs no token, since its embedded executor never calls the API. A standalone server on Kubernetes does: its sync pods call the API with `PIPELINE_EXECUTOR_API_TOKEN`.

The Helm chart takes the token from `internalApi.secret`, generates one on first install when it is empty, and keeps it across upgrades. It passes it to the server and jobs pods as `PIPELINE_EXECUTOR_API_TOKEN` and to the executor pods as `EXECUTOR_API_TOKEN`. See [Kubernetes: secrets](/synclet-site/docs/deployment/kubernetes/#secrets).

Keep port 8081 off the public network. The chart serves it only through the ClusterIP Service `<fullname>-internal`, which no Ingress or HTTPRoute routes to.

An executor drops `DB_DSN`, `AUTH_JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, `SECRET_ENCRYPTION_KEY_PREVIOUS`, `PIPELINE_EXECUTOR_API_TOKEN` and `WATERMILL_*` from its environment at startup and logs a warning for each, so a shared env file does not hand it the control plane's secrets.

## Registration and the executor list

Each executor, the embedded one included, reports itself to the server at startup and every `EXECUTOR_REGISTRATION_INTERVAL` (default `15s`): its ID, type, version, capacity (`DOCKER_EXECUTOR_MAX_CONCURRENT_JOBS` for Docker, none for Kubernetes) and resource defaults.

**Settings > System** lists the executors that reported within `PIPELINE_EXECUTOR_SILENCE_TIMEOUT` (default `60s`), with their type, version, capacity and last-seen time. The page refreshes every 15 seconds. The same list is available to any workspace member through the `ListExecutors` RPC. An executor that stops reporting drops off the list but keeps its row in the database.

## Owner IDs

Every container, Kubernetes Job and Secret an executor creates carries the label `synclet.io/owner` with its owner ID. Its cleanup lists only resources with its own owner ID. For each one it asks the server whether the job is still running, and removes it when the server says no, including when the job is unknown.

| Executor | Variable | Default |
|---|---|---|
| Docker | `DOCKER_EXECUTOR_OWNER_ID` | hostname |
| Kubernetes | `K8S_EXECUTOR_OWNER_ID` | hostname |

The owner ID is also the executor's ID in the executor list.

Give every executor that shares a Docker daemon or a namespace its own owner ID. Two Synclet installations with the same owner ID on one daemon or namespace delete each other's running containers or Jobs, because each one's server does not know the other's jobs. Two executors of one installation with the same ID show up as a single row in the executor list.

Keep the ID stable across restarts. After a restart, the executor cleans up only the leftovers of the executor with its own ID. The Compose file sets a fixed `hostname: synclet` for that reason. The chart runs the executor as a StatefulSet, so each replica keeps its pod name (`<fullname>-executor-0`, `-1`, …) as its owner ID. Its standalone server uses the release's full name. `k8s.ownerId` and `pipeline.dockerOwnerId` override them.

## How work is claimed

A sync goes through these steps:

1. The scheduler (in `synclet jobs`, or in a standalone server) creates scheduled jobs for due connections every `PIPELINE_JOB_SCHEDULER_INTERVAL`, while fewer than `PIPELINE_MAX_CONCURRENT_JOBS` jobs are scheduled, starting or running. An advisory lock keeps one scheduler cycle at a time across replicas.
2. Every executor polls for work every `*_JOB_WORKER_INTERVAL`. A claim is one `UPDATE … WHERE id = (SELECT … ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)`: the oldest scheduled job goes to exactly one executor, and concurrent claims skip it instead of waiting. Connector tasks are claimed the same way.
3. While the sync runs, its heartbeat updates the job. The heartbeat watchdog (in `synclet jobs`, every `PIPELINE_JOB_WATCHDOG_INTERVAL`) fails starting or running jobs whose last heartbeat is older than `PIPELINE_HEARTBEAT_TIMEOUT` (default `30s`). A failed job is scheduled again while it has attempts left (`PIPELINE_DEFAULT_MAX_ATTEMPTS`, or the connection's own setting).

Because a claim is atomic, executors need no coordination with each other.

## Scaling

- **Docker executors.** Run one `synclet docker-executor` per Docker host, each with its own owner ID. Total throughput is the sum of their `DOCKER_EXECUTOR_MAX_CONCURRENT_JOBS`.
- **Kubernetes executors.** One replica can launch any number of Jobs, so extra replicas add availability rather than capacity. Set `executor.replicaCount` in the chart; each replica gets its owner ID from its pod name.
- **Overall limit.** `PIPELINE_MAX_CONCURRENT_JOBS` caps the jobs the scheduler keeps active, whatever the number of executors.
- **API servers.** `synclet server` replicas are stateless; scale them separately from the executors.

A Docker executor that stops while syncs are running: its jobs stop sending heartbeats, the watchdog fails them, and another executor picks up their retries. When it starts again under the same owner ID, it removes the containers those jobs left behind.

## See also

- [Kubernetes](/synclet-site/docs/deployment/kubernetes/): the chart's executor and `k8s.*` options
- [Docker](/synclet-site/docs/deployment/docker/): running Synclet with the host's Docker daemon
- [Architecture](/synclet-site/docs/concepts/architecture/): how a sync runs
- [Environment Variables](/synclet-site/docs/reference/environment-variables/#distributed-mode)
