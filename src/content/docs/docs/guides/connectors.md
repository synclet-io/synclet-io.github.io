---
title: Managing Connectors
description: Install, star, update and delete connectors, manage connector repositories, and add custom images.
---

A workspace has its own set of installed connectors. Sources and destinations are built on them, and the **Add Source** and **Add Destination** pages offer only installed connectors. Manage them under **Settings > Connectors**, which has three tabs: **Sources**, **Destinations** and **Repositories**. For what a connector is and how it runs, see [Connectors & Airbyte Protocol](/synclet-site/docs/concepts/connectors/).

| Action | Who |
|---|---|
| View installed connectors and repositories | Everyone |
| Star, add custom, update and delete connectors | Editors and admins |
| Add, sync and delete repositories | Admins |

## Installed Connectors

The **Sources** and **Destinations** tabs list the installed connectors of each type with their name, Docker image, tag and available update. Narrow the list with the repository filter (**All repositories**, one repository, or **Custom** for connectors added by image) and the **Search connectors...** box.

### How Connectors Get Installed

Connectors are installed from repositories. When a repository syncs, every connector in its registry that the workspace does not have yet is installed, at the version the registry lists. A new workspace gets the **Airbyte OSS** and **Synclet** repositories, so their catalogs appear after the first sync. If **Add Source** says **No source connectors installed yet** in a new workspace, that first sync may still be running.

A connector you delete is installed again on the next sync of its repository, as long as the registry still lists it.

### Stars and Used Connectors

Click the star next to a connector, here or on the **Add Source** and **Add Destination** pages, to mark it. Stars are shared by the whole workspace, and only editors and admins can set them. On the add pages, **Starred** shows only starred connectors.

The add pages also group connectors: those that at least one source or destination of the workspace is built on come first, under **Used in this workspace**, and the rest under **Other connectors**.

### Updating Connectors

When the repository lists a different tag than the installed one, the **Update** column shows that version and an **Update** button. Updating sets the connector's tag and configuration spec to the repository's version. Every source or destination built on the connector uses the new version from its next run.

If the registry declares breaking changes between the installed and the new version, **Update** opens **Breaking Changes Detected** first. It lists each breaking version with its message and a **Migration guide** link when the registry has one. Click **Update Anyway** to update, or **Keep Current Version** to leave it.

**Update All (N)** updates every connector with an available update that matches the repository filter and search, sources and destinations alike. Those without breaking changes are updated at once; for each one with breaking changes, the same dialog opens in turn so you can confirm or skip it.

Breaking changes are detected only when both tags are semantic versions, such as `3.0.23`.

Only connectors installed from a repository can be updated this way. To move a custom connector to another tag, add it again with the new tag.

### Deleting a Connector

Click **Delete** and confirm. A connector that a source or destination is built on cannot be deleted: the error says how many depend on it. Delete or move those first.

## Custom Images

Any Docker image that implements the Airbyte protocol can be installed directly, for example a connector you build yourself:

1. On the **Sources** or **Destinations** tab, click **Add Custom**.
2. Enter the **Docker Image** (for example `ghcr.io/acme/source-billing`), the **Tag** (`latest` by default), a **Name**, and the **Type**.
3. Click **Add Connector**.

Synclet runs the image's `spec` command before saving it, so the dialog waits until the image has been pulled and has answered. If `spec` fails, the connector is not added and the dialog shows the error.

A custom connector appears under the **Custom** repository filter. Synclet does not track new versions of it. To publish your own connectors with versions and updates instead, put them in a registry and add it as a repository; see [Publishing a connector](/synclet-site/docs/connector-development/publishing-a-connector/).

## Connector Repositories

A repository is a registry URL that lists connectors with their images, versions and specs. The **Repositories** tab lists each one with its **URL**, **Status** (`synced` or `failed`, with the error under the URL), number of **Connectors** and **Last Synced** time.

| Default repository | Registry URL |
|---|---|
| **Airbyte OSS** | `https://connectors.airbyte.com/files/registries/v0/oss_registry.json` |
| **Synclet** | `https://synclet-io.github.io/connectors/registry.json` |

Both are added to every new workspace and can be deleted like any other. Most of Airbyte's connectors are under ELv2; read [Connector licenses](/synclet-site/docs/reference/connector-licenses/) before you rely on one.

### Adding a Repository

1. Click **Add Repository**.
2. Choose a **Repository Preset**: **Airbyte OSS**, or **Custom** to enter a **Name** and a **Registry URL**.
3. For a private registry, enter the **Auth Header**: the value Synclet sends as the `Authorization` header, such as `Bearer <token>`. It is stored encrypted.
4. Click **Add Repository**.

### Syncing

Synclet syncs every repository in the background once an hour (`PIPELINE_JOB_REPOSITORY_SYNC_INTERVAL`, see [Background job intervals](/synclet-site/docs/reference/environment-variables/#background-job-intervals)). **Sync Now** on a repository's row syncs it right away. A sync refreshes the repository's list of connectors and versions, which is where update availability comes from, and installs the connectors the workspace does not have yet. If the registry cannot be fetched, the repository is marked `failed` with the error and its previous list is kept.

### Deleting a Repository

Click **Delete** and confirm. The installed connectors that came from it stay, along with the sources and destinations built on them, but lose their repository link: they are no longer updated and show under the **Custom** filter.

## Next Steps

- [Sources](/synclet-site/docs/guides/sources/) and [Destinations](/synclet-site/docs/guides/destinations/) — Build on the installed connectors.
- [Writing a connector](/synclet-site/docs/connector-development/writing-a-connector/) — Build your own connector image.
- [Connector licenses](/synclet-site/docs/reference/connector-licenses/) — Licenses of the connector images.
