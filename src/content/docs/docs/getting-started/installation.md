---
title: Installation
description: Install Synclet using Docker Compose, a pre-built binary, or build from source.
---

## Prerequisites

Before installing Synclet, make sure you have the following:

| Requirement | Details |
|---|---|
| **PostgreSQL 16** | Used for all Synclet metadata, sync state, and configuration. Included in the Docker Compose setup. |
| **Docker** | Required to run Airbyte connectors. Docker Engine 20.10+ or Docker Desktop. |
| **Helm 3** *(optional)* | Only needed if you plan to deploy Synclet on Kubernetes. |

## Docker Compose (Recommended)

The fastest way to get Synclet running. This setup includes PostgreSQL, Synclet, and automatic database migrations.

```bash
# Clone the repository
git clone https://github.com/synclet-io/synclet.git
cd synclet

# Start all services in the background
docker compose up -d
```

This starts:

- **PostgreSQL 16** on port 5432 (mapped to host port 5437)
- **Synclet** on port 8080 (API + dashboard)
- Automatic database migrations on first startup (via the `migrate` service)

Open your browser and navigate to [http://localhost:8080](http://localhost:8080) to access the dashboard. You will be prompted to create your first admin account.

## Pre-built Binary

Download a pre-compiled archive from the [GitHub Releases](https://github.com/synclet-io/synclet/releases) page. Each release tag is named `synclet-v<version>` and publishes `synclet-v<version>-<os>-<arch>.tar.gz` archives for `linux/amd64`, `linux/arm64`, `darwin/amd64` and `darwin/arm64`, plus `SHA256SUMS` over every archive.

**1. Download, verify and extract the archive**

```bash
# Download the archive for your platform and SHA256SUMS, e.g.
# synclet-v0.12.0-linux-amd64.tar.gz
sha256sum -c SHA256SUMS --ignore-missing            # Linux
shasum -a 256 -c SHA256SUMS --ignore-missing        # macOS
tar -xzf synclet-v0.12.0-linux-amd64.tar.gz
cd synclet-v0.12.0-linux-amd64
```

**2. Set required environment variables**

```bash
# Only DB_DSN is strictly required for the binary to boot.
export DB_DSN="postgres://user:password@localhost:5432/synclet?sslmode=disable"
```

With `ENVIRONMENT` unset or `development` and outside a container, Synclet generates an **ephemeral** `AUTH_JWT_SECRET` and persists a `SECRET_ENCRYPTION_KEY` to `<UserConfigDir>/synclet/encryption.key` for a local trial. Anywhere else it refuses to start until both are set: generate each with `openssl rand -base64 32`, keep them in your secret manager and back up the encryption key.

See [Environment Variables](/synclet-site/docs/reference/environment-variables/) for every variable and its default.

**3. Run database migrations**

```bash
./synclet migrate up
```

**4. Start the server**

```bash
./synclet server --standalone
```

`--standalone` runs the API, the background jobs and an in-process executor in one process. Without it, `server` serves only the API and no sync runs until you start `synclet jobs` and an executor separately (see the [CLI reference](/synclet-site/docs/reference/cli/)).

Synclet is now running on port 8080 by default.

## Build from Source

If you prefer to compile Synclet yourself, you need **Go 1.26+** installed.

```bash
# Clone the repository
git clone https://github.com/synclet-io/synclet.git
cd synclet

# Build the binary
go build -o bin/synclet .

# Or, if you have Task installed:
task build
```

The compiled binary is located at `./bin/synclet`. Follow the same steps as the [Pre-built Binary](#pre-built-binary) section to configure and run it.

## Verifying Installation

Once Synclet is running, verify that everything is working:

**1. Check the readiness endpoint**

```bash
curl http://localhost:8081/ready
```

You should receive a `200 OK` response. Health endpoints are served on the internal port (`8081` by default), not on the UI port.

**2. Open the dashboard**

Navigate to [http://localhost:8080](http://localhost:8080) in your browser. The Synclet dashboard should load.

**3. Create your first account**

On the first visit, Synclet will prompt you to create an admin account. Enter your email and password to complete the setup.

## Next Steps

- [Configuration](/synclet-site/docs/getting-started/configuration/) — Fine-tune Synclet with environment variables for SMTP, OIDC, sync behavior, and more.
- [Quick Start](/synclet-site/docs/getting-started/quick-start/) — Create your first source, destination, and connection.
