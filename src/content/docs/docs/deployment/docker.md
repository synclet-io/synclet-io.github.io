---
title: Docker Deployment
description: Deploy Synclet with Docker Compose, a standalone Docker container or the binary, with health checks, monitoring and backups.
---

Synclet ships as a single container image. The fastest way to get running is Docker Compose, which bundles PostgreSQL alongside Synclet. You can also run the container standalone or skip Docker entirely with a bare binary.

## Docker Compose (Recommended)

Docker Compose starts PostgreSQL 16, runs database migrations, and starts Synclet in one command.

```bash
git clone https://github.com/synclet-io/synclet.git
cd synclet
docker compose up -d
```

The default `docker-compose.yml` includes four services:

- **`postgres`** — PostgreSQL 16, data stored in a named volume, published on `127.0.0.1:5437`.
- **`migrate`** — Runs `synclet migrate up` once before Synclet starts and exits.
- **`local-root`** — Makes `/tmp/synclet_local` on the host world-writable (mode `1777`) once and exits, so connectors running as any user can write there.
- **`synclet`** — API, scheduler, workers and the Docker executor in a single container (started with `server --standalone`), published on `127.0.0.1:8080`.

The `synclet` service runs as `user: "0:0"`: root reaches the Docker socket whatever group owns it on the host, and can write to `/tmp/synclet` and `/tmp/synclet_local`, which the Docker daemon creates root-owned. Access to the Docker socket is root-equivalent on the host either way.

:::caution
`.env.compose` ships default values for `AUTH_JWT_SECRET` and `SECRET_ENCRYPTION_KEY`. They are public: anyone with the repository knows them. Before exposing Synclet beyond localhost, set both in an untracked `.env` next to `docker-compose.yml` (it overrides `.env.compose`), each to the output of `openssl rand -base64 32`. Back up the encryption key — stored connector secrets cannot be decrypted without it.
:::

Once the containers are healthy, open the dashboard at **http://localhost:8080**.

### Customizing the Compose file

| Variable | Purpose | Default |
|---|---|---|
| `DB_DSN` | PostgreSQL connection string | Set by Compose |
| `AUTH_JWT_SECRET` | Token signing key (min. 32 characters) | Public default in `.env.compose`; override in `.env` |
| `SECRET_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256 key for credentials | Public default in `.env.compose`; override in `.env` |
| `PUBLIC_HTTP_SERVER_ADDR` | Public HTTP listen address | `0.0.0.0:8080` |
| `INTERNAL_HTTP_SERVER_ADDR` | Internal HTTP listen address (executor API, `/live`, `/ready`, `/metrics`) | `0.0.0.0:8081` |
| `DOCKER_EXECUTOR_TEMP_DIR_ROOT` | Per-task scratch dir (config / catalog / state) under which connector bind mounts are created. **Required when Synclet itself runs in a container with the host docker.sock mounted** — see note below. | `/tmp/synclet` |
| `DOCKER_EXECUTOR_LOCAL_ROOT` | Host directory mounted at `/local` in every connector container and never cleaned: file-writing destinations (DuckDB, CSV, local JSON, SQLite) leave their files here. Like the temp dir, it must be bind-mounted at the same path on the host. | `/tmp/synclet_local` |

Generate production secrets before first start:

```bash
# AUTH_JWT_SECRET
openssl rand -base64 32

# SECRET_ENCRYPTION_KEY (must be exactly 32 bytes, base64-encoded)
openssl rand -base64 32
```

## Docker Standalone

If you already have a PostgreSQL 16 instance, run the published image `ghcr.io/synclet-io/synclet:<version>` on its own (releases are listed on [GitHub Releases](https://github.com/synclet-io/synclet/releases)).

```bash
docker run -d \
  --name synclet \
  --user 0:0 \
  -p 8080:8080 \
  -e DB_DSN="postgres://synclet:password@host.docker.internal:5432/synclet?sslmode=disable" \
  -e AUTH_JWT_SECRET="$(openssl rand -base64 32)" \
  -e SECRET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e DOCKER_EXECUTOR_TEMP_DIR_ROOT="/tmp/synclet" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/synclet:/tmp/synclet \
  ghcr.io/synclet-io/synclet:0.12.0 server --standalone
```

> **Why the docker.sock and the temp dir?**
> Synclet needs access to the Docker socket (`/var/run/docker.sock`) to launch Airbyte connector containers during syncs. The image runs as a non-root user by default; `--user 0:0` lets it reach the socket whatever group owns it on the host.
>
> When Synclet itself runs **inside** a container and talks to the host daemon via that socket, every per-task scratch file (the rendered `config.json`, `catalog.json`, and `state.json`) is created by Synclet on the container's filesystem, but the daemon that mounts it into the connector container is on the host. `DOCKER_EXECUTOR_TEMP_DIR_ROOT` is the path inside Synclet's container where those files are written — it **must** be bind-mounted from an identically-named path on the host (e.g. both `/tmp/synclet`) so the host daemon can resolve the bind-mount source.
>
> Running the binary natively on the host? Leave `DOCKER_EXECUTOR_TEMP_DIR_ROOT` unset — Synclet falls back to the OS temp dir, which the host daemon can already see.
>
> Run `synclet migrate up` once against the same database before starting the server (or front it with a `migrate` sidecar — see the bundled compose file).

Verify the container is running:

```bash
docker logs synclet
```

## Binary (No Docker)

You can run Synclet as a plain binary without Docker.

1. Download the latest release from [GitHub Releases](https://github.com/synclet-io/synclet/releases).
2. Set the required environment variables (see [Environment Variables](/synclet-site/docs/reference/environment-variables/)).
3. Run migrations and start the server:

```bash
export DB_DSN="postgres://synclet:password@localhost:5432/synclet?sslmode=disable"
export ENVIRONMENT=production

# Required outside local development; generate each with: openssl rand -base64 32
export AUTH_JWT_SECRET="your-jwt-secret"
export SECRET_ENCRYPTION_KEY="your-encryption-key"

synclet migrate up
synclet server --standalone
```

The dashboard is available at `http://localhost:8080`.

> **Important:** Connectors still require Docker on the host: every connector, Synclet's own Go connectors included, runs as a Docker container.

## Health Checks

Synclet serves `/live` and `/ready` on the internal port (`8081` by default) for load balancers and orchestrators:

```bash
curl http://localhost:8081/ready
# Returns HTTP 200 when the database, background jobs and event router are up
```

The default Synclet image is based on distroless and does not include `curl` or `wget`. To add Docker health checks, use a multi-stage build that includes a health-check binary, or check from outside the container:

```bash
# Health check from the host or a sidecar
curl -f http://localhost:8081/ready
```

## Monitoring

- **Dashboard** — The built-in web UI at `http://localhost:8080` shows pipeline status, job history, and logs.
- **Prometheus metrics** — Synclet exposes a `/metrics` endpoint compatible with Prometheus on the internal port (`8081`). See [Production Checklist](/synclet-site/docs/deployment/production/) for scraping configuration.

## Backup & Restore

### Database backup

Back up your PostgreSQL database regularly:

```bash
pg_dump -Fc "$DB_DSN" > synclet_$(date +%Y%m%d).dump

# Restore
pg_restore -d "$DB_DSN" synclet_20260401.dump
```

Keep `SECRET_ENCRYPTION_KEY` with every backup: without it the credentials in the dump cannot be decrypted. See [Backup and Restore](/synclet-site/docs/deployment/backup-and-restore/) for the full procedure.

