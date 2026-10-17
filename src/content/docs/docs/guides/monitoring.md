---
title: Monitoring & Jobs
description: Dashboard, job history, logs, Prometheus metrics.
---

Synclet provides built-in tools for monitoring your data syncs — a real-time dashboard, detailed job history, per-connector logs, and Prometheus-compatible metrics for external observability.

## Dashboard

The dashboard is the landing page after you log in. It provides a high-level view of your workspace's sync health.

### Overview Stats

- **Total connections** — How many connections exist in the workspace.
- **Active syncs** — How many syncs are currently running.
- **Recent failures** — Connections that failed in the last 24 hours.
- **Records synced** — Total records moved over a selected time range.

### Health Indicators

Each connection shows a status badge:

| Status | Meaning |
|---|---|
| **Active** | Connection is enabled and syncs run on schedule. |
| **Inactive** | Connection is disabled. No syncs are scheduled. |
| **Paused** | Connection is temporarily paused (e.g., due to schema change policy). |

### Sync Timeline

The dashboard includes a timeline chart showing sync activity over the past 24 hours, 7 days, or 30 days. Each bar represents a sync job, color-coded by status. Hover over a bar to see the connection name, duration, and record count.

## Job History

Every sync run creates a job. You can browse all jobs from the **Jobs** page in the sidebar.

### Job States

| State | Description |
|---|---|
| **Scheduled** | The job is enqueued and waiting for a worker. |
| **Starting** | The job is initializing (pulling connector image, preparing workspace). |
| **Running** | The job is actively syncing data. |
| **Completed** | The job completed successfully. |
| **Failed** | The job failed after exhausting all retry attempts. |
| **Cancelled** | The job was manually cancelled by a user. |

### Filtering

You can filter the job list by:

- **Connection** — Show jobs for a specific connection.
- **Status** — Show only failed, succeeded, or running jobs.
- **Date range** — Narrow down to a specific time period.

Click any job to view its details.

## Job Detail

The job detail page shows everything about a specific sync run.

### Attempt Breakdown

Each job may have multiple attempts if retries are configured. For each attempt, you can see:

- **Start time** and **end time**.
- **Duration**.
- **Status** — whether the attempt succeeded or failed.
- **Error message** — if the attempt failed, the connector's error output.

### Sync Stats

For each attempt, the job detail shows aggregate sync statistics:

| Metric | Description |
|---|---|
| **Records read** | Number of records read from the source. |
| **Bytes synced** | Data volume transferred. |
| **Duration** | Time spent on this attempt. |

### Errors

If a job failed, the error section shows the connector's error output with timestamps. Common errors include authentication failures, schema mismatches, network timeouts, and rate limit violations.

## Logs

Synclet captures logs from each connector during a sync. Logs are available per attempt in the job detail view.

### Log Levels

| Level | Description |
|---|---|
| **INFO** | Normal operational messages — records processed, state checkpoints. |
| **WARN** | Non-fatal issues — skipped records, deprecated features, approaching limits. |
| **ERROR** | Failures that caused the sync to stop — authentication errors, connection drops. |

Logs can be filtered by level to focus on warnings and errors during troubleshooting.

### Log storage and archiving

While a job runs, its log lines are stored in PostgreSQL and the UI tails them from there. Each attempt keeps at most `PIPELINE_LOG_MAX_LINES_PER_ATTEMPT` lines (100,000 by default, `0` disables the cap); later lines are dropped and counted in a single `[synclet] log truncated: N further lines dropped` line.

`PIPELINE_LOG_ARCHIVE_BACKEND` decides where the logs of finished jobs go:

| Backend | Where logs of finished jobs live |
|---|---|
| `none` (default) | They stay in PostgreSQL until job retention deletes the job. |
| `filesystem` | Files under `PIPELINE_LOG_ARCHIVE_DIR`. Every server replica must see the same directory, so use a shared volume. |
| `s3` | Any S3-compatible bucket: AWS S3, MinIO, Cloudflare R2, Google Cloud Storage through its S3 interoperability endpoint (HMAC keys), or the [Garage store bundled with the Helm chart](/synclet-site/docs/deployment/kubernetes/#log-archive). Set `PIPELINE_LOG_ARCHIVE_S3_ENDPOINT` for anything but AWS, and `PIPELINE_LOG_ARCHIVE_S3_USE_PATH_STYLE=true` for MinIO. Without static keys the default AWS credential chain is used (environment, IRSA, instance profile). |
| `gcs` | Google Cloud Storage through its native API. With `PIPELINE_LOG_ARCHIVE_GCS_CREDENTIALS_FILE` it uses that service account key; without it, Application Default Credentials (GKE Workload Identity, `GOOGLE_APPLICATION_CREDENTIALS`, or `gcloud auth application-default login` locally). |

With an archive backend, a finished job's logs move out of PostgreSQL into one gzipped NDJSON object per attempt, keyed `logs/<workspace>/<connection>/<job>/<attempt>.ndjson.gz`, and the UI reads them back from there. Job retention and workspace deletion remove the objects too.

The server logs which GCS credential source it uses at startup. Credentials are resolved on first use, so missing credentials show up as archive errors and in `synclet_log_archive_failures_total`, not as a startup failure.

Switching back to `none` leaves already archived logs where they are, but they can no longer be read from the UI.

All variables are listed under [Environment Variables: Job Logs](/synclet-site/docs/reference/environment-variables/#job-logs).

## Prometheus Metrics

Synclet exposes a Prometheus-compatible metrics endpoint for integration with external monitoring systems like Grafana.

### Metrics Endpoint

```
GET /metrics
```

The endpoint is served on the internal port (`INTERNAL_HTTP_SERVER_ADDR`, `8081` by default), not on the public UI port, and returns metrics in the Prometheus exposition format.

```bash
curl -s http://localhost:8081/metrics
```

### Key Metrics

| Metric | Type | Description |
|---|---|---|
| `synclet_syncs_total` | Counter | Total number of syncs by workspace, connection, and status. |
| `synclet_sync_duration_seconds` | Histogram | Duration of sync operations in seconds. |
| `synclet_records_synced_total` | Counter | Total records synced by workspace, connection, and direction. |
| `synclet_bytes_synced_total` | Counter | Total bytes synced by workspace and connection. |
| `synclet_active_syncs` | Gauge | Number of currently running syncs. |
| `synclet_failed_syncs_total` | Counter | Total number of failed syncs by workspace and connection. |
| `synclet_pending_jobs` | Gauge | Number of pending jobs in the queue. |
| `synclet_connector_sync_duration_seconds` | Histogram | Duration of sync operations by connector type. |
| `synclet_log_archive_failures_total` | Counter | Job attempts whose logs failed to archive, by archive backend (`filesystem`, `s3`, `gcs`). |
| `synclet_log_archive_bytes_total` | Counter | Total size in bytes of the job log objects written to the log archive. |
| `synclet_log_lines_dropped_total` | Counter | Job log lines dropped by the per-attempt line cap (`PIPELINE_LOG_MAX_LINES_PER_ATTEMPT`). |

### Kubernetes ServiceMonitor

With the Prometheus Operator, let the Helm chart create the `ServiceMonitor`. It scrapes `/metrics` on the internal Service port:

```yaml
server:
  serviceMonitor:
    enabled: true
    interval: 30s
    labels:
      release: prometheus   # match your Prometheus selector
```

## Health Endpoints

Synclet serves two probes on the internal port (`8081` by default):

| Endpoint | Returns `200` when |
|---|---|
| `GET /live` | The process answers HTTP. |
| `GET /ready` | Every health check passes: the database answers, background jobs have started and the event router is running (the last two only in processes that run them). Otherwise `503`, with the failing checks in the JSON body. |

```bash
curl -s http://localhost:8081/ready
```

Point load balancer health checks and Kubernetes probes at these endpoints. Images up to 0.4.0 serve only `GET /health` on the public port.

## Next Steps

- [Scheduling & Triggers](/synclet-site/docs/guides/scheduling/) — Configure when syncs run and how retries work.
- [Notifications](/synclet-site/docs/guides/notifications/) — Get alerted when syncs fail.
- [Environment Variables](/synclet-site/docs/reference/environment-variables/) — Configure metrics, log storage, and health check settings.
