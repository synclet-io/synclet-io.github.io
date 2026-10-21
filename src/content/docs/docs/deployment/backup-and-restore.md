---
title: Backup and Restore
description: What to back up, the encryption key that must go with it, and how to restore a Synclet installation.
---

Synclet keeps all of its state in PostgreSQL. The server, jobs and executor processes hold nothing that a restart would lose, so a backup is the database plus the key that decrypts the credentials stored in it.

## What to back up

| What | Why |
|---|---|
| The PostgreSQL database | Everything: users, workspaces and members, sources, destinations and connections, stream configuration, sync state (cursors), jobs and their logs, notification settings, API keys, the audit log. Each module has its own schema (`auth`, `workspace`, `pipeline`, `secret`, `notify`, `audit`); dump the whole database, not single schemas. |
| `SECRET_ENCRYPTION_KEY` | Connector credentials are stored AES-encrypted in the `secret` schema. A dump restored without the key that encrypted them is unusable: no source or destination can authenticate. |
| `SECRET_ENCRYPTION_KEY_PREVIOUS`, during a key rotation | Rotation is lazy: a credential is re-encrypted with the new key only when it is next read. A backup taken while both keys are set can hold credentials under either, so keep both with it. |
| The log archive bucket or directory, if `PIPELINE_LOG_ARCHIVE_BACKEND` is not `none` | The logs of finished jobs. Synclet runs without them, but the UI can no longer show logs it cannot read. |

`AUTH_JWT_SECRET` needs no backup: a new one only signs everyone out.

### Where the encryption key comes from

Synclet reads the key from the `SECRET_ENCRYPTION_KEY` environment variable: a base64-encoded 32-byte key. Back up the value from wherever you set it (your `.env`, secret manager or Kubernetes Secret).

- **Helm.** The key is `encryption.key`, the `encryption-key` key of `encryption.existingSecret`, or the Vault path when `vso.enabled` is set. When none is set, the chart generates one on first install and stores it in `<fullname>-secrets`:

  ```bash
  kubectl get secret <fullname>-secrets -n <namespace> \
    -o jsonpath='{.data.encryption-key}' | base64 -d
  ```

  The chart finds the generated key again on upgrade with a Helm `lookup`, which returns nothing under `helm template` and some GitOps tools. Set the key yourself there, through `encryption.key` or `encryption.existingSecret`.
- **Docker Compose.** `.env.compose` holds a public default key, overridden by `SECRET_ENCRYPTION_KEY` in `.env`. Synclet warns at startup while the public default is in use.
- **Binary in local development.** When `ENVIRONMENT` is unset or `development` and Synclet is not in a container, a missing key is generated once and stored in `<UserConfigDir>/synclet/encryption.key` (`~/.config/synclet/encryption.key` on Linux, `~/Library/Application Support/synclet/encryption.key` on macOS). Back up that file. Anywhere else Synclet refuses to start without the variable.

Store the key apart from the database backups, so that one leaked backup does not expose both.

## Config export is not a backup

**Settings > General > Export Configuration** writes a workspace's sources, destinations and connections to YAML. It is meant for moving a setup between installations (see [Settings: Config Export & Import](/docs/guides/settings/#config-export--import)), and it leaves out most of what a restore needs:

- Config keys that look like secrets (containing `password`, `secret`, `token`, `key`, `credential` or `private`) are exported as `***REDACTED***`. New sources and destinations created by an import need their credentials entered again.
- Connections carry only their source, destination, schedule, max attempts, enabled flag and tags. Stream selection, sync modes, transforms, namespace settings and connection names are not exported, and an import creates new connections with defaults.
- Sync state is not exported, so imported incremental connections start from scratch.
- Users, members, roles, notification settings, webhooks, API keys, job history and the audit log are not exported.

Back up the database.

## Backing up the database

Any PostgreSQL backup method works. Synclet needs nothing special from it.

### pg_dump

```bash
pg_dump -Fc "$DB_DSN" > synclet_$(date +%Y%m%d).dump
```

A dump is consistent at the moment it starts, without stopping Synclet. Schedule it daily at least, and copy it off the database host.

### Managed PostgreSQL

On RDS, Cloud SQL, Azure Database for PostgreSQL and similar services, turn on automated backups with point-in-time recovery (PITR). PITR restores the database to any moment within the retention window, which a nightly dump cannot.

### CloudNativePG

On Kubernetes, [CloudNativePG](https://cloudnative-pg.io/) runs PostgreSQL with continuous WAL archiving and base backups to S3, GCS or Azure Blob. Recent releases do this through the [Barman Cloud plugin](https://cloudnative-pg.io/plugin-barman-cloud/):

```yaml
apiVersion: barmancloud.cnpg.io/v1
kind: ObjectStore
metadata:
  name: synclet-backups
spec:
  configuration:
    destinationPath: s3://synclet-backups/cnpg
    s3Credentials:
      inheritFromIAMRole: true    # IRSA; or accessKeyId/secretAccessKey from a Secret
    wal:
      compression: gzip
  retentionPolicy: "30d"
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: synclet-db
spec:
  instances: 2
  storage:
    size: 20Gi
  plugins:
    - name: barman-cloud.cloudnative-pg.io
      isWALArchiver: true
      parameters:
        barmanObjectName: synclet-backups
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: synclet-db-daily
spec:
  schedule: "0 0 3 * * *"         # seconds field first
  cluster:
    name: synclet-db
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
```

For GCS, use `destinationPath: gs://<bucket>/cnpg` with `googleCredentials` instead of `s3Credentials`. Point the chart at the cluster's `<cluster>-rw` Service with `postgresql.enabled: false` and `externalDatabase.*`. CloudNativePG restores into a new `Cluster` whose `bootstrap.recovery` names the object store, optionally with a `recoveryTarget` time.

The chart's bundled PostgreSQL (`postgresql.enabled: true`) is meant for development and testing and has no backups of its own.

## Restoring

1. **Stop Synclet.** Stop every process that writes to the database: the server, the jobs worker and the executors. With Helm, scale them to zero:

   ```bash
   kubectl scale deployment <fullname>-server <fullname>-jobs --replicas=0 -n <namespace>
   kubectl scale statefulset <fullname>-executor --replicas=0 -n <namespace>
   ```

   In standalone mode only `<fullname>-server` exists. With Compose, `docker compose stop synclet`.

2. **Restore the database** into an empty database:

   ```bash
   pg_restore --no-owner -d "$DB_DSN" synclet_20260401.dump
   ```

   Or restore a managed snapshot, a PITR target or a CloudNativePG recovery cluster, and point `DB_DSN` at it.

3. **Set the same encryption key** the backup was taken with in `SECRET_ENCRYPTION_KEY`, and `SECRET_ENCRYPTION_KEY_PREVIOUS` if a rotation was in progress.

4. **Apply migrations.** Run the Synclet version you are about to start, the same as the backup's or newer:

   ```bash
   synclet migrate up
   ```

   The Helm chart runs it in the `migrate` init container of the server and jobs pods, and the Compose file in its `migrate` service, so starting them is enough.

5. **Start Synclet**: the server and jobs first, then the executors. Check `/ready` on the internal port, then test the connection of a source with stored credentials: with the wrong key, Synclet cannot decrypt them and the test fails.

Jobs that were running when the backup was taken come back as `starting` or `running` with an old heartbeat. The heartbeat watchdog fails them after `PIPELINE_HEARTBEAT_TIMEOUT` and schedules a retry while attempts remain.

Destination data written after the backup stays in the destination. Incremental connections resume from the cursor stored in the backup and read those records again: append-mode streams can end up with duplicates, deduplicated streams do not.

## See also

- [Upgrading](/docs/deployment/upgrading/)
- [Production Checklist](/docs/deployment/production/)
- [Environment Variables: Secret Rotation](/docs/reference/environment-variables/#secret-rotation)
- [Monitoring: log storage](/docs/guides/monitoring/#log-storage-and-archiving)
