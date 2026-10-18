---
title: Connectors & Airbyte Protocol
description: Connectors that implement the Airbyte Protocol in Synclet — how they run, which ones are tested, native Go connectors.
---

## What are Connectors?

Connectors are Docker images that know how to read data from a specific system (source) or write data to one (destination). Every connector implements the [Airbyte Protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol), which defines four standard operations:

| Operation | Purpose |
|---|---|
| **spec** | Returns the connector's configuration schema (what fields are needed to connect) |
| **check** | Tests the provided credentials and confirms the connection works |
| **discover** | Lists available streams (tables, endpoints, files) and their schemas |
| **read** / **write** | Reads data from a source or writes data to a destination |

Synclet runs connectors that implement the Airbyte Protocol. Which pairs are tested, with versions, is listed under [Tested with](#tested-with); each connector image keeps its own license, see [Connector licenses](/synclet-site/docs/reference/connector-licenses/).

## Popular Sources

Source connectors that implement the Airbyte Protocol exist for many systems, for example:

- **Databases** — PostgreSQL, MySQL, MongoDB, SQL Server, Oracle
- **SaaS Platforms** — Salesforce, HubSpot, Stripe, Shopify, Zendesk, Jira
- **Files & Storage** — Google Sheets, Amazon S3, Azure Blob Storage, SFTP
- **Messaging & Events** — Kafka, RabbitMQ
- **Analytics** — Google Analytics, Facebook Ads, LinkedIn Ads
- **Developer Tools** — GitHub, GitLab, Notion, Slack

Browse the full catalog from **Settings > Connectors** in the Synclet dashboard.

## Popular Destinations

- **Data Warehouses** — BigQuery, Snowflake, Redshift, ClickHouse, Databricks
- **Databases** — PostgreSQL, MySQL, MSSQL
- **Files & Storage** — Amazon S3, Google Cloud Storage, Google Sheets
- **Search & Analytics** — Elasticsearch, Apache Pinot

## Adding a Connector

### Step 1: Configure a Repository

Synclet ships with Airbyte's public OSS registry pre-configured, so its catalog is available on first start; most of its connectors are ELv2, see [Connector licenses](/synclet-site/docs/reference/connector-licenses/). To add a private or custom registry, go to **Settings > Connectors > Repositories** and add the registry URL.

### Step 2: Create a Source or Destination

1. Navigate to **Sources** (or **Destinations**) in the sidebar.
2. Click **Add Source** (or **Add Destination**).
3. Search for and select your connector from the catalog.
4. Fill in the required credentials (database host, API key, OAuth, etc.). All credentials are encrypted with **AES-256-GCM** before being stored.
5. Click **Test Connection** to verify everything works.
6. Save.

### Step 3: Use It in a Connection

Once a source or destination is saved, you can reference it when [creating a connection](/synclet-site/docs/guides/connections/). A single source or destination can be used in multiple connections.

## Tested with

These pairs were run end to end through Synclet 0.6.0 (`main` at `1b02969`) on 2026-10-18: Docker executor, PostgreSQL 16, two runs per pair so the second run starts from the saved state. A connector that is not listed here may work; it has not been tested.

| Source | Destination | Streams and mode | Result |
|---|---|---|---|
| `airbyte/source-faker:6.2.38` | `airbyte/destination-postgres:3.0.23` | `users`, incremental, append | Passed: 100 records; the second run read 0 new records and kept 100 rows |
| `airbyte/source-postgres:3.8.7` | `airbyte/destination-postgres:3.0.23` | `public.cities`, incremental on `id`, append | Passed: 250 records; the second run re-read the row at the cursor (251 rows, at-least-once delivery) |
| `airbyte/source-faker:6.2.38` | `airbyte/destination-postgres:3.0.23` | `users`, full refresh, overwrite | First run passed (100 rows); the repeat run read 0 records and left the table empty, see known issues |

The matrix is produced by [`tests/e2e/tested_with_test.go`](https://github.com/synclet-io/synclet/blob/main/tests/e2e/tested_with_test.go), an opt-in end-to-end test. To regenerate it, run `task e2e:tested-with` with `E2E_DATABASE_URL` pointing at a PostgreSQL that connector containers can reach through `TESTED_WITH_PG_HOST` (default `host.docker.internal`); the test logs one `TESTED-WITH` line per run.

CI also runs the end-to-end suite on every push to `main` and every pull request, with Synclet's own protocol test connectors: full refresh, incremental state across runs, several streams and a failing connector, on the Docker executor.

### Known issues

The failing pairs below were found in a manual run on 2026-10-18 and are not part of the test yet.

- **Full refresh after a stateful run:** Synclet passes the saved stream state to a full-refresh stream on the next run, so a source that honours state in full refresh (`source-faker`) reads nothing and an overwrite destination empties the table.
- **`ghcr.io/synclet-io/connectors/source-postgres:0.2.0` to `airbyte/destination-postgres` 3.0.23 and 3.0.12:** the destination fails with `sourceStats must be set with recordCount for state message`; Synclet does not add `sourceStats` to state messages.
- **`airbyte/source-faker:6.2.38` to `airbyte/destination-dev-null:0.7.24`:** the destination fails on a stream status trace message it receives (`AirbyteStreamStatusTraceMessage ... status is null`).
- **`airbyte/destination-duckdb:0.6.0`:** needs a writable `/local` mount, which Synclet does not provide to connector containers.

Report a connector that works or fails in [GitHub issues](https://github.com/synclet-io/synclet/issues) with its image and version.

## Configuring Streams

When you create a connection, Synclet runs **discover** on the source to list all available streams. For each stream, you can configure:

- **Enabled/disabled** — Choose which streams to include in the sync.
- **Sync mode** — Set the [source read mode and destination write mode](/synclet-site/docs/concepts/sync-modes/) independently per stream.
- **Field selection** — Pick only the columns you need instead of syncing the entire schema.
- **Primary key override** — Specify a custom primary key if the connector's default is not correct (required for deduplication).
- **Namespace rewriting** — Change the destination schema or dataset name where the stream's data lands.

See the [Stream Configuration](/synclet-site/docs/guides/stream-configuration/) guide for detailed instructions.

## Native Go Connectors

In addition to community Airbyte connectors, Synclet maintains a set of **native Go connectors** built with `airbyte-go-sdk`. They speak the same Airbyte protocol over stdin/stdout and ship as their own container images alongside the Synclet repo.

| Connector | Type | Image directory |
|---|---|---|
| Google Sheets | Source & Destination | `connectors/source-google-sheets/`, `connectors/destination-google-sheets/` |
| MySQL | Source | `connectors/source-mysql/` |
| BigQuery | Destination | `connectors/destination-bigquery/` |

Native connectors appear in the catalog alongside Docker-based community connectors and are configured the same way — the difference is that the implementation is Go (with smaller image size and faster cold starts) instead of Python or Java.

## Container Behavior

When running Docker-based connectors, Synclet manages the container lifecycle automatically:

- **Image pull** — Connector images are pulled on first use. The pull has a **10-minute timeout** to handle slow registries.
- **Resource limits** — Containers are started with default limits of **2 GB memory** and **1 CPU**. These can be overridden in the [configuration](/synclet-site/docs/getting-started/configuration/).
- **Stale cleanup** — A background process checks for stale or orphaned containers every **5 minutes** and removes them.
- **Graceful shutdown** — When a sync is cancelled, Synclet sends `SIGTERM` to the container and waits up to **30 seconds** before forcing termination.

## Next Steps

- [Sync Modes](/synclet-site/docs/concepts/sync-modes/) — Understand how data is read from sources and written to destinations.
- [Sources Guide](/synclet-site/docs/guides/sources/) — Step-by-step guide for adding and managing sources.
- [Destinations Guide](/synclet-site/docs/guides/destinations/) — Step-by-step guide for adding and managing destinations.
