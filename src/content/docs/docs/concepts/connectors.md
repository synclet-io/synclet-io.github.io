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

Every new workspace gets two registries, so their catalogs are available on first start: Airbyte's public OSS registry, whose connectors are mostly ELv2 (see [Connector licenses](/synclet-site/docs/reference/connector-licenses/)), and Synclet's own, with the [native Go connectors](#native-go-connectors). To add a private or custom registry, go to **Settings > Connectors > Repositories** and add the registry URL. Installing, updating and deleting connectors, and adding custom images, are covered in [Managing Connectors](/synclet-site/docs/guides/connectors/).

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

These pairs were run end to end through Synclet 0.6.0 (`main` at `b7d946b`) on 2026-10-19: Docker executor, PostgreSQL 16, two runs per pair so the second run starts from the saved state. A connector that is not listed here may work; it has not been tested.

| Source | Destination | Streams and mode | Result |
|---|---|---|---|
| `airbyte/source-faker:6.2.38` | `airbyte/destination-postgres:3.0.23` | `users`, incremental, append | Passed: 100 records; the second run read 0 new records and kept 100 rows |
| `airbyte/source-postgres:3.8.7` | `airbyte/destination-postgres:3.0.23` | `public.cities`, incremental on `id`, append | Passed: 250 records; the second run re-read the row at the cursor (251 rows, at-least-once delivery) |
| `ghcr.io/synclet-io/connectors/source-postgres:0.2.0` | `airbyte/destination-postgres:3.0.23` | `public.cities`, incremental on `id`, append | Passed: 250 records; the second run re-read the row at the cursor (251 rows, at-least-once delivery) |
| `airbyte/source-faker:6.2.38` | `airbyte/destination-postgres:3.0.23` | `users`, full refresh, overwrite | Passed: 100 records; the second run re-read all 100 and kept 100 rows |
| `airbyte/source-faker:6.2.38` | `airbyte/destination-dev-null:0.7.24` | `users`, full refresh, overwrite | Passed: 100 records; the second run re-read all 100 |

The matrix is produced by [`tests/e2e/tested_with_test.go`](https://github.com/synclet-io/synclet/blob/main/tests/e2e/tested_with_test.go), an opt-in end-to-end test. To regenerate it, run `task e2e:tested-with` with `E2E_DATABASE_URL` pointing at a PostgreSQL that connector containers can reach through `TESTED_WITH_PG_HOST` (default `host.docker.internal`); the test logs one `TESTED-WITH` line per run.

CI also runs the end-to-end suite on every push to `main` and every pull request, with Synclet's own protocol test connectors: full refresh, incremental state across runs, several streams and a failing connector, on the Docker executor.

### Known issues

No failing pairs are known from the last run.

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

Besides the community Airbyte connectors, Synclet has its own MIT-licensed connectors, written in Go on [synclet-go-sdk](https://github.com/synclet-io/synclet-go-sdk) and kept in the [synclet-io/connectors](https://github.com/synclet-io/connectors) repository. synclet-go-sdk is a small SDK for the Airbyte protocol: a connector implements a typed `Source` or `Destination` interface, and the SDK runs it as a process that answers `spec`, `check`, `discover`, `read` and `write`.

Each connector ships as its own Docker image, `ghcr.io/synclet-io/connectors/<name>`, and runs like any other connector container. The repository publishes a registry at `https://synclet-io.github.io/connectors/registry.json`; every new workspace gets it as the **Synclet** repository, next to Airbyte OSS, so these connectors appear in the catalog and are configured the same way as the community ones. The [repository README](https://github.com/synclet-io/connectors#readme) lists the connectors.

To write or publish one, see the Connector Development guides:

- [Writing a connector](/synclet-site/docs/connector-development/writing-a-connector/) — spec, check, discover, read, state and the conformance suite, with source-postgres as the example.
- [Publishing a connector](/synclet-site/docs/connector-development/publishing-a-connector/) — the release tag, the GHCR image, the registry entry, or your own connectors repository.

## Container Behavior

When running Docker-based connectors, Synclet manages the container lifecycle automatically:

- **Image pull** — Connector images are pulled on first use. The pull has a **10-minute timeout** to handle slow registries.
- **Resource limits** — Containers are started with default limits of **2 GB memory** and **1 CPU**. These can be overridden in the [configuration](/synclet-site/docs/getting-started/configuration/).
- **Stale cleanup** — A background process checks for stale or orphaned containers every **5 minutes** and removes them.
- **Graceful shutdown** — When a sync is cancelled, Synclet sends `SIGTERM` to the container and waits up to **30 seconds** before forcing termination.

### Files written by destinations

Destinations that write files, such as `destination-duckdb`, `destination-csv`, `destination-local-json` and `destination-sqlite`, write under `/local` inside the connector container, as on the Airbyte platform. Where the files end up depends on the executor:

- **Docker** — Set `DOCKER_EXECUTOR_LOCAL_ROOT` to a host directory. It is mounted at `/local` in every connector container, so a destination path of `/local/x.duckdb` lands at `<root>/x.duckdb` on the host. The directory is shared by all jobs and connectors and never cleaned; give each connection its own file name in the destination's config. The directory must be writable by the connector images' user: a root Synclet creates is made `1777` (world-writable and sticky, like `/tmp`, so users cannot remove each other's files), and an existing one keeps its permissions, with a warning at startup when it is not writable by others. The `docker-compose.yml` quickstart sets it to `/tmp/synclet_local` on the host and makes it `1777`. Unset, each job gets its own `/local`, removed with the job, and the files are lost.
- **Kubernetes** — Set the Helm value `k8s.localVolume` to the name of an existing PersistentVolumeClaim (the executor reads it as `K8S_EXECUTOR_LOCAL_VOLUME_CLAIM`). The claim is mounted at `/local` in the connector containers and the files land on that volume. Connector pods can run on several nodes at once, so the claim needs `ReadWriteMany` unless they all run on one node, and it must be writable by the connector image's user. Unset, each pod gets an `emptyDir`, removed with the pod.

## Next Steps

- [Sync Modes](/synclet-site/docs/concepts/sync-modes/) — Understand how data is read from sources and written to destinations.
- [Sources Guide](/synclet-site/docs/guides/sources/) — Step-by-step guide for adding and managing sources.
- [Destinations Guide](/synclet-site/docs/guides/destinations/) — Step-by-step guide for adding and managing destinations.
