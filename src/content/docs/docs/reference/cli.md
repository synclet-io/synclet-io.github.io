---
title: CLI Commands
description: "Reference for the synclet command line: running the server in standalone or distributed mode, global flags and database migrations."
---

Synclet is distributed as a single binary. All operations — running the server, managing migrations, and executing syncs — are subcommands of `synclet`.

## Commands

| Command | Description |
|---|---|
| `synclet server` | Start the API server. |
| `synclet server --standalone` | Start the API server with background jobs and sync executor in a single process. |
| `synclet jobs` | Run background jobs (scheduler, workers) as a separate process. |
| `synclet docker-executor` | Run the Docker sync executor daemon. |
| `synclet k8s-executor` | Run the Kubernetes sync executor daemon. |
| `synclet migrate up` | Apply all pending database migrations. |
| `synclet migrate down --module <name>` | Roll back the latest migration of one module (`--all` for every module). |
| `synclet migrate status` | Show migration status. |
| `synclet migrate create <module> <name>` | Create a new migration file. |
| `synclet generate dotenv` | Append every environment variable missing from the first `--dotenv` file (`.env` by default), with its default. |
| `synclet users reset-link --email <email>` | Print a single-use password reset link for a user. |

## Global Flags

| Flag | Description |
|---|---|
| `--dotenv <path>` | Load environment variables from the specified `.env` file(s). Can be repeated. |
| `--version` | Print the Synclet version. |

## Server

`synclet server` starts the HTTP API. In **standalone mode** (`--standalone`), it also starts background jobs (scheduler, workers) and the sync executor in the same process — this is the simplest way to run Synclet.

```bash
# Start in standalone mode (API + jobs + executor in one process)
DB_DSN=postgres://user:pass@localhost:5432/synclet \
AUTH_JWT_SECRET=your-secret \
SECRET_ENCRYPTION_KEY=your-base64-key \
synclet server --standalone

# Load config from a .env file
synclet server --standalone --dotenv .env
```

In standalone mode, the executor is automatically selected: Docker on regular hosts, Kubernetes when running inside a K8s pod (detected via the in-cluster environment).

The public HTTP server binds to `0.0.0.0:8080` by default (configurable via `PUBLIC_HTTP_SERVER_ADDR`). See [Environment Variables](/synclet-site/docs/reference/environment-variables/) for the full list of configuration options.

### Distributed Mode

For larger deployments, you can run the API server, background jobs, and executor as separate processes:

```bash
# Process 1: API server only
synclet server

# Process 2: Background jobs
synclet jobs

# Process 3: Docker executor
synclet docker-executor

# Or Kubernetes executor
synclet k8s-executor
```

The `docker-executor` and `k8s-executor` commands never open the database: they claim work from the API server through `EXECUTOR_API_URL` and `EXECUTOR_API_TOKEN`.

## Migrations

The server does not apply migrations when it starts. Run `migrate up` before starting it; Docker Compose runs it as the `migrate` service and the Helm chart as an init container.

```bash
# Apply all pending migrations
synclet migrate up

# Roll back the latest migration of one module, or of every module
synclet migrate down --module pipeline
synclet migrate down --all

# Check migration status
synclet migrate status

# Create a new migration file
synclet migrate create auth add_api_tokens
```

The `--module` flag can be used with `up` and `status` to target a specific module. `down` requires either `--module` or `--all`, and when `ENVIRONMENT` is not `development` it also requires `--yes` to confirm the rollback.

Each module's migrations hold a Postgres advisory lock while they run, so concurrent `migrate up` runs (one per replica) take turns instead of failing.

Migrations are idempotent — running `migrate up` on an already up-to-date database is a no-op.

## Generate

### `synclet generate dotenv`

Appends every environment variable the binary reads, with its default, to the first `--dotenv` file (`.env` when none is given). Variables already set in that file are left alone; variables without a default are written commented out.

Aliases: `synclet gen dotenv`, `synclet generate env`

```bash
# Append missing variables to ./.env
synclet generate dotenv

# Append to another file
synclet generate dotenv --dotenv config/synclet.env
```

This is useful when setting up a new environment or after upgrading to discover newly added configuration options.

## Users

### `synclet users reset-link`

Prints a password reset link for the user with the given email. The link expires in 1 hour and can be used once; issuing a new link invalidates the previous one. It works with or without SMTP configured.

```bash
synclet users reset-link --email jane@example.com
```
