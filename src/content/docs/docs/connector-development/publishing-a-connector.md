---
title: Publishing a connector
description: Release a connector from synclet-io/connectors — meta.json, release-please, the <dir>-v<version> tag, the GHCR image and the registry entry — or run your own connectors repository and registry from synclet-io/synclet-connectors-template.
---

A connector reaches Synclet in three pieces: a Docker image on GHCR, an entry in a connector registry (`registry.json`) that names the image and carries its spec, and a Synclet install that reads that registry. This page covers both ways to get there:

- [In synclet-io/connectors](#in-synclet-ioconnectors): contribute the connector to Synclet's own MIT catalog. Merged connectors are released by the repository's workflows and listed in the registry every Synclet install reads by default.
- [In your own repository](#your-own-connectors-repository): create a repository from [synclet-io/synclet-connectors-template](https://github.com/synclet-io/synclet-connectors-template), which has the same layout, scripts and release flow, and add its registry to your Synclet.

Writing the connector itself is covered in [Writing a connector](/synclet-site/docs/connector-development/writing-a-connector/).

## In synclet-io/connectors

### 1. Fill in meta.json

`meta.json` holds what the registry says about the connector. It is validated against `schema/meta.schema.json`. source-postgres:

```json
{
  "$schema": "../../schema/meta.schema.json",
  "name": "Postgres",
  "connector_type": "source",
  "version": "0.2.0",
  "release_stage": "alpha",
  "support_level": "community",
  "source_type": "database",
  "license": "MIT",
  "documentation_url": "https://github.com/synclet-io/connectors/tree/main/connectors/source-postgres",
  "icon_url": "",
  "language": "go",
  "tags": ["database", "postgres"],
  "breaking_changes": {},
  "external_documentation_urls": []
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Display name in Synclet |
| `connector_type` | yes | `source` or `destination`; must match the directory prefix |
| `version` | yes | Semver, the image tag Synclet runs. Start a new connector at `0.1.0`; after that release-please sets it, never edit it by hand |
| `release_stage` | yes | `alpha`, `beta`, `generally_available`, `custom` |
| `support_level` | yes | `community`, `certified` |
| `license` | yes | The connector's own license (SPDX id), published in the registry and shown in Synclet |
| `source_type` | no | `api`, `database`, `file`; empty for destinations |
| `documentation_url`, `icon_url` | no | Shown in the connector catalog |
| `breaking_changes` | no | `{"2.0.0": {"message": "...", "upgrade_deadline": "2027-01-31"}}` |
| `tombstone` | no | `true` hides the connector in Synclet without deleting its history |

The other optional fields, each with the registry field it becomes:

| Field | Registry field | Value |
|---|---|---|
| `language` | `language` | string, `go` for the connectors here |
| `tags` | `tags` | array of strings |
| `erd_url` | `erdUrl` | URL |
| `release_date` | `releaseDate` | date, `YYYY-MM-DD` |
| `migration_documentation_url` | `releases.migrationDocumentationUrl` | URL |
| `external_documentation_urls` | `externalDocumentationUrls` | array of `{"title", "url", "type"}`; `title` and `url` required |
| `allowed_hosts` | `allowedHosts.hosts` | array of strings |
| `suggested_streams` | `suggestedStreams.streams` | array of stream names |
| `max_seconds_between_messages` | `maxSecondsBetweenMessages` | integer, at least 1 |
| `supports_refreshes` | `supportsRefreshes` | boolean |
| `supports_file_transfer` | `supportsFileTransfer` | boolean |
| `supports_data_activation` | `supportsDataActivation` | boolean |
| `resource_requirements` | `resourceRequirements.jobSpecific` | array of `{"job_type", "memory_request", "memory_limit", "cpu_request", "cpu_limit"}`; `job_type` is `get_spec`, `check_connection`, `discover_schema` or `sync` |

A `breaking_changes` entry takes `message` (required), `upgrade_deadline` and `migration_documentation_url`. Editors that understand `$schema` autocomplete all of them from `schema/meta.schema.json`.

### 2. Add a release-please package

Each connector is its own [release-please](https://github.com/googleapis/release-please) package. Add one to `release-please-config.json`, copied from another connector:

```json
"connectors/source-acme": {
  "component": "source-acme",
  "extra-files": [{ "type": "json", "path": "meta.json", "jsonpath": "$.version" }]
}
```

Leave the connector out of `.release-please-manifest.json`: a connector missing there is not released yet, and release-please opens its first release pull request at `0.1.0` (the config's `initial-version`). Merging that pull request adds it to the manifest. `task validate` fails until the package exists and `meta.json` declares `0.1.0`.

### 3. List the connector in the README

Add a row for the connector to the table in the repository's `README.md`, in the same form as the others:

```
| [source-acme](connectors/source-acme) | `ghcr.io/synclet-io/connectors/source-acme` |
```

### 4. Check locally and open a pull request

```bash
task validate                                  # every meta.json and spec.json against the schema, release-please packages
task test CONNECTOR=source-acme                # go vet + go test (Docker for testcontainers)
task lint CONNECTOR=source-acme                # golangci-lint
task spec:check CONNECTOR=source-acme          # spec.json matches the image's `spec`
task entry CONNECTOR=source-acme | jq .        # the registry entry a release will publish
```

`task entry` prints the entry in the [Airbyte OSS registry format](https://connectors.airbyte.com/files/registries/v0/oss_registry.json) that Synclet reads, built from `meta.json` and `spec.json`: `dockerRepository` is `ghcr.io/synclet-io/connectors/<dir>`, `dockerImageTag` is the `meta.json` version, and `spec` is `spec.json`.

On the pull request, `ci.yml` validates all metadata, checks that release-please lists every connector at its `meta.json` version, dry-runs registry generation and, for each changed connector, runs `go vet`, golangci-lint and `go test -race` (with Docker), builds the image and compares `spec.json` with its `spec` output.

### 5. Commit with Conventional Commits

Versions come from [Conventional Commits](https://www.conventionalcommits.org). Use the connector directory as the scope:

```
feat(source-acme): read the invoices stream
fix(source-acme): retry on HTTP 429
feat(source-acme)!: rename the `items` stream to `orders`
```

`fix` releases a patch, `feat` a minor version, and `!` or a `BREAKING CHANGE:` footer a major version; `chore`, `docs`, `test`, `ci` and `refactor` release nothing on their own. release-please assigns a commit to every connector whose directory it touches, whatever the scope says. Record a breaking change in `breaking_changes` in `meta.json` too, so Synclet can warn before the upgrade.

### 6. Release: the tag and the GHCR image

```
main ─────────────────► release-please.yml
                        └─ one release pull request per connector with releasable commits
                           ("chore: release <dir> <version>"); merging it bumps meta.json,
                           .release-please-manifest.json and CHANGELOG.md and creates the tag <dir>-v<version>

tag <dir>-v<version> ──► release.yml
                        ├─ plan: the tag must match connectors/<dir>/meta.json's version
                        └─ image: spec check, build linux/amd64 + linux/arm64, push
                              ghcr.io/synclet-io/connectors/<dir>:<version> and :latest,
                              run `spec` on the pushed image for both platforms, check it is public

Release succeeded ────► registry.yml (on main)
                        └─ rebuild registry.json and deploy it to GitHub Pages
```

After a merge to main, release-please opens or updates one pull request per connector with releasable changes. Merging it creates the GitHub release and the tag, for example `source-postgres-v0.2.0`, which runs the Release workflow. A failed release can be re-run from **Actions → Release → Run workflow** with the same tag; until a release succeeds, the registry keeps the previous version.

The first push of a connector creates a **private** GHCR package. Synclet pulls images anonymously, so the first release fails at "Image is publicly pullable" until a maintainer makes the package public (**synclet-io → Packages → connectors/\<name\> → Package settings → Change visibility → Public**) and re-runs the release for the same tag.

### 7. The registry entry

The repository serves its own registry on GitHub Pages:

```
https://synclet-io.github.io/connectors/registry.json
```

After every successful release, `registry.yml` rebuilds it on main with `go run ./scripts registry --released`: for each connector it takes the newest `<dir>-v<version>` tag whose image can be pulled anonymously and reads `meta.json` and `spec.json` as of that tag, so a release still running or failed is never listed. **Actions → Registry → Run workflow** republishes it by hand.

This URL is the "Synclet" connector repository every new Synclet workspace gets by default, next to Airbyte OSS; once the registry is deployed, the connector appears in the catalog at the next repository sync (every `PIPELINE_JOB_REPOSITORY_SYNC_INTERVAL`, default `1h`, or **Sync** on the repository). `synclet-io/synclet-connector-registry`, which listed the first Go connectors, is no longer where entries go: Synclet's migration `20261018000001_synclet_registry_url` points existing installs from it to the URL above.

To remove a connector, set `"tombstone": true` in a `fix(<dir>):` or `feat(<dir>)!:` commit and release it; Synclet hides tombstoned entries while their images stay available.

## Your own connectors repository

For connectors you keep outside synclet-io/connectors (private systems, a different license, your own release cadence), create a repository from [synclet-io/synclet-connectors-template](https://github.com/synclet-io/synclet-connectors-template). It has the same layout, `Taskfile.yml`, scripts, CI and release flow, with one example connector, `source-example`. Images are pushed as `ghcr.io/<owner>/<repo>/<connector>` and the registry is published at `https://<owner>.github.io/<repo>/registry.json`; both follow from the repository's name. The template repository itself never releases: its workflows check `is_template`.

1. **Create the repository.** **Use this template → Create a new repository**, and make it **public**: Synclet fetches `registry.json` and pulls images anonymously. (A private repository works only with Pages visibility set to public and the images made public.) The first Release Please run fails because the App secrets do not exist yet; re-run it from **Actions → Release Please** after step 2.
2. **Create a GitHub App for releases.** Tags and pull requests made with the default `GITHUB_TOKEN` start no workflows, so release-please uses a GitHub App token. Create an App (webhook inactive) with repository permissions **Contents**, **Pull requests** and **Issues: Read and write**, generate a private key, install it on the repository, and add two repository secrets: `RELEASE_APP_ID` (the App ID) and `RELEASE_APP_PRIVATE_KEY` (the `.pem` contents).
3. **Enable GitHub Pages** with the **GitHub Actions** source: **Settings → Pages → Build and deployment → Source: GitHub Actions**, or `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`.
4. **Add a connector.** Copy `connectors/source-example`, write it as in [Writing a connector](/synclet-site/docs/connector-development/writing-a-connector/), fill `meta.json` at `0.1.0`, run `task spec`, and add its package to `release-please-config.json` (not to the manifest), exactly as [above](#2-add-a-release-please-package). Point `documentation_url` and the spec's `DocumentationURL` at your repository, or delete `source-example` and its release-please entry once you have your own connector. Image names default to `ghcr.io/<owner>/<repo>` of the `origin` remote; `IMAGE_PREFIX=...` overrides it in `task` commands.
5. **Release** with Conventional Commits, the same way: release-please opens `chore: release <dir> <version>` pull requests, merging one creates `<dir>-v<version>`, the Release workflow pushes `ghcr.io/<owner>/<repo>/<dir>:<version>` and `:latest` for both platforms, and the Registry workflow redeploys `registry.json`.
6. **Make each image public** after its first push: your profile or organization → **Packages** → `<repo>/<connector>` → **Package settings → Change visibility → Public**, then re-run the release for the same tag.
7. **Add the registry to Synclet**: **Settings → Connectors → Add Repository**, with a name and `https://<owner>.github.io/<repo>/registry.json`. Synclet fetches the file immediately (the repository is not saved if that fails) and re-syncs it every `PIPELINE_JOB_REPOSITORY_SYNC_INTERVAL`.

The template's README has the same steps with every screen named.
