---
title: Schema Changes
description: How Synclet detects source schema changes, how to apply them, and when it pauses a connection.
---

A source's schema drifts: tables and columns are added and removed, column types change. Synclet compares what a connection is set up to sync with what the source last reported, and lists the differences as pending schema changes.

## How Changes Are Detected

Each source keeps its latest **discovered catalog**: the streams and column types its connector reported the last time Synclet ran `discover` on it. Discovery runs when:

- a source is created, or its configuration is saved;
- you click **Refresh from source** on a connection's **Schema changes** tab;
- you click **Refresh Catalog** on a connection's **Streams** page or on the source's page.

Syncs do not run discovery, so a change in the source shows up only after one of these. Creating a connection in the wizard can also run discovery on its source.

Pending changes are the differences between the streams the connection has saved and that catalog:

| Change | Label | Meaning |
|---|---|---|
| `stream_added` | Added | The source offers a stream the connection does not sync. |
| `stream_removed` | Removed | A stream the connection syncs is gone from the source. |
| `column_added` | Added | A synced stream has a new column. |
| `column_removed` | Removed | A column of a synced stream is gone. |
| `column_type_changed` | Modified | A column's type changed. Nullability alone is not a change: `["string", "null"]` and `"string"` count as the same type. |

Only enabled streams are saved with a connection, so a stream you left disabled on purpose is listed as **Added** for as long as the source offers it.

## The Schema Changes Tab

Open a connection and go to **Schema changes** (`/connections/<id>/schema-changes`). With changes pending, the tab shows how many, the connection's schema change policy, and a table with the **Namespace**, **Stream**, **Change**, **Column**, **Old type** and **New type** of each change. With none, it shows **No pending schema changes**.

**Refresh from source** runs discovery on the source now and updates the list when it finishes. Discovery runs on the source, so it refreshes every connection that reads from it.

On the **Connections** list, a connection with pending changes carries a **Schema drift** badge that links to this tab.

## Applying or Clearing Changes

Changes are applied by saving the connection's streams:

1. Open the connection and click **Streams**.
2. The page loads the source's latest catalog. Enable the new streams you want, and review fields, sync modes, cursors and primary keys of the changed ones.
3. Click **Save Configuration**.

When the streams are saved, each one takes its schema from the latest catalog, so column changes of the enabled streams are cleared, as are streams that are gone from the source. Streams you leave disabled stay listed as **Added**.

See [Stream Configuration](/synclet-site/docs/guides/stream-configuration/) for the settings of a stream.

## Schema Change Policy

Every connection has a policy, set when it is created and under **Settings > Schema Change Policy** (**When source schema changes**):

| Option | Value |
|---|---|
| **Propagate changes** | `propagate` |
| **Ignore changes** | `ignore` |
| **Pause on change** (**Pause on changes** in the wizard) | `pause` |

In the current release the policy is stored and shown, but Synclet does not act on it: whatever the policy, syncs keep using the saved streams, pending changes wait until you save the streams, and a schema change alone does not pause a connection. Connections created through the UI and through [config import](/synclet-site/docs/guides/settings/#config-export--import) default to **Propagate changes**; one created through the API without a policy gets **Pause on change**.

## Paused by Synclet

Synclet pauses a connection itself when a schema change breaks its [transforms](/synclet-site/docs/guides/transforms/). After every discovery, it compiles the mappers of each connection on that source against the new catalog. When a stream's mappers no longer compile, for example because a mapper reads a column that was removed or retyped, the connection is set to **Paused**, whatever its schema change policy, and its `status_reason` records the first stream and mapper that failed, such as:

```text
stream "public.orders": mapper step 1, field "amount": ...
```

A paused connection has no scheduled syncs. The reason is returned by the API on the connection (`status_reason`); the UI shows the **paused** status. Connections that are already paused are not rechecked.

To resume, fix the stream's mappers on the **Streams** page, then click **Enable** on the connection. Enabling clears `status_reason`.

## Next Steps

- [Stream Configuration](/synclet-site/docs/guides/stream-configuration/) — Sync modes, fields, cursors and primary keys.
- [Transforms](/synclet-site/docs/guides/transforms/) — Mappers and how they are validated.
- [Creating Connections](/synclet-site/docs/guides/connections/) — Connection settings and status.
