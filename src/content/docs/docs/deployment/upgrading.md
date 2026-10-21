---
title: Upgrading
description: How to upgrade Synclet with Helm, Docker Compose or the binary, and the breaking changes of each release.
---

Releases, with their notes, are on [GitHub Releases](https://github.com/synclet-io/synclet/releases). Synclet and its Helm chart are versioned separately. Their change logs are [CHANGELOG.md](https://github.com/synclet-io/synclet/blob/main/CHANGELOG.md) and the chart's [CHANGELOG.md](https://github.com/synclet-io/synclet/blob/main/deploy/helm/synclet/CHANGELOG.md).

## Before you upgrade

1. Read the release notes of every version between yours and the target, and the [version notes](#version-notes) below.
2. Back up the database and keep the encryption key with it. See [Backup and Restore](/docs/deployment/backup-and-restore/).

## Migrations

Each release brings its schema changes as migrations, applied by `synclet migrate up`. Run it against the database before the new version starts. It applies only the migrations the database lacks, so running it again is harmless. Each module's migrations hold a PostgreSQL advisory lock while they run, so several `migrate up` started at once are safe.

- **Helm.** The server and jobs pods run `synclet migrate up` in a `migrate` init container, so a `helm upgrade` migrates before the new server starts.
- **Docker Compose.** The `migrate` service runs `migrate up`, and `synclet` starts only after it has completed.
- **Binary or plain `docker run`.** Run `synclet migrate up` yourself, with the new version, before you start it.

`synclet migrate status` lists applied and pending migrations. To go back to an older version after its migrations ran, restore the backup. `synclet migrate down` rolls back only the latest migration of one module (`--module`) or of every module (`--all`), and needs `--yes` when `ENVIRONMENT` is not `development`.

## Executors and the server

Executors never touch the database. They talk to the server through the executor API (see [Executors](/docs/deployment/executors/)). Upgrade them together with the server, from the same release. Synclet does not check that their versions match. **Settings > System** shows each executor's version, so an executor left on an old one is easy to spot.

The Helm chart runs the server, jobs worker, executor and the orchestrator container of every sync pod (`K8S_EXECUTOR_SYNCLET_IMAGE`) from one image, so they move together. Syncs already running when the executor restarts keep their pods; a sync whose heartbeat stops is failed after `PIPELINE_HEARTBEAT_TIMEOUT` and retried.

## Helm

```bash
helm upgrade synclet oci://ghcr.io/synclet-io/charts/synclet \
  --version <chart version> \
  -f values.yaml \
  --namespace synclet
```

The chart's `appVersion` is the Synclet version it deploys; `image.tag` overrides it. The JWT secret, encryption key, internal API token and PostgreSQL password the chart generated on install are read back from `<fullname>-secrets` and kept. Pass your values file with `-f` on every upgrade: `--reuse-values` carries the previous release's defaults over.

## Docker Compose

The Compose file pins the image tag. To upgrade, update the checkout and recreate the containers:

```bash
git pull
docker compose up -d
```

If you keep your own copy of `docker-compose.yml`, change its `x-synclet-image` tag instead. Your `.env` is not tracked and stays as it is.

## Binary

Stop Synclet, replace the binary with the one from the release, run `synclet migrate up`, and start it again.

## Version notes

Breaking and operator-visible changes, newest first. Versions not listed need nothing beyond the steps above.

### Chart 0.4.0 (Synclet 0.7.0)

- **The executor is a StatefulSet.** In distributed mode, delete the old Deployment before upgrading. Helm cannot turn a Deployment into a StatefulSet:

  ```bash
  kubectl delete deployment <fullname>-executor -n <namespace>
  helm upgrade synclet oci://ghcr.io/synclet-io/charts/synclet --version 0.4.0 -f values.yaml -n <namespace>
  ```

  Syncs already running keep their pods, which report to the server directly.
- **`executor.strategy` is now `executor.updateStrategy`.** It takes a StatefulSet update strategy, `type: RollingUpdate` or `OnDelete`, without `maxSurge`. A values file that still sets `executor.strategy` fails to render. The old chart's default, carried over by `--reuse-values`, is tolerated.
- **Kubernetes owner label.** The Kubernetes executor stamps `synclet.io/owner` on its Jobs and Secrets and cleans up only its own (see [owner IDs](/docs/deployment/executors/#owner-ids)). Jobs and Secrets created by earlier versions carry no owner label, and no executor removes them. Once no sync is running, delete them by hand:

  ```bash
  kubectl delete jobs,secrets -n <k8s.namespace> -l 'synclet.io/sync-job,!synclet.io/owner'
  kubectl delete jobs,secrets -n <k8s.namespace> -l 'synclet.io/task,!synclet.io/owner'
  ```

- **Connector pods get no Kubernetes API token** unless a connector service account is created or named (`pipeline.serviceAccount`, `pipeline.resources.serviceAccountName`, or `service_account_name` in a runtime config). A connector that called the Kubernetes API needs one of those now.

### Synclet 0.6.0 (chart 0.3.0)

- **Executors run without the database.** `synclet docker-executor` and `synclet k8s-executor` need `EXECUTOR_API_URL` and `EXECUTOR_API_TOKEN`. The server needs the same token as `PIPELINE_EXECUTOR_API_TOKEN`. An executor drops `DB_DSN` and the other control-plane variables from its environment. The Helm chart wires all of this.
- **The executor commands lost `--standalone`.** Use `synclet server --standalone` for a single process.
- **Docker owner label.** The Docker executor stamps `synclet.io/owner` on its containers and cleans up only its own. Containers left by earlier versions (labelled `synclet.io/managed=true` without `synclet.io/owner`) are not removed; remove them by hand once no sync is running. Give each executor that shares a Docker daemon its own `DOCKER_EXECUTOR_OWNER_ID`.

### Synclet 0.5.0 (chart 0.2.0)

- **Health probes moved.** `/live` and `/ready` are served on the internal port (`8081`). Images up to 0.4.0 serve only `/health` on the public port. The chart's probes default to the new paths. To run an old image with a newer chart, see [Kubernetes: health checks](/docs/deployment/kubernetes/#health-checks).
- **Secrets are required and validated.** Outside local development (`ENVIRONMENT` set to anything but `development`, or in a container) the server exits when `AUTH_JWT_SECRET` or `SECRET_ENCRYPTION_KEY` is missing. `AUTH_JWT_SECRET` must be at least 32 bytes and `SECRET_ENCRYPTION_KEY` a base64-encoded 32-byte key. Earlier versions generated a missing encryption key and stored it in `<UserConfigDir>/synclet/encryption.key` of the process's user. An installation that relied on that must copy the file's content into `SECRET_ENCRYPTION_KEY` before upgrading, or its stored credentials cannot be decrypted.
- **The image runs as a non-root user.** A container that starts connectors through the host's `docker.sock` needs `--user 0:0` (or a group that owns the socket); see [Docker](/docs/deployment/docker/#docker-standalone).
- **`synclet migrate down`** needs `--module` or `--all`, and `--yes` outside development.
- **The chart** waits for PostgreSQL and runs `migrate up` before the jobs worker and executor start.

Synclet 0.5.1 adds a catch-up migration that creates objects missing on databases created by early versions, so upgrade older installations to 0.5.1 or later in one step rather than stopping at 0.5.0.
