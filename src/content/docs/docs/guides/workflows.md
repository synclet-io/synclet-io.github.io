---
title: Workflows
description: Run connections in order as a graph of steps, on one schedule, with a history of runs.
---

A workflow runs several connections in a set order. It is a named graph of steps: each step is one connection, and each step can run after one or more other steps. A workflow has its own cron schedule and keeps a history of its runs.

Use a workflow when one sync has to finish before another starts, for example when a load into the warehouse must be complete before the connection that reads from it runs. Without a workflow, every connection runs on its own schedule, and keeping an order means spacing the schedules apart.

## Example

A workflow with four steps:

```text
        ┌──▶ B ──┐
A ──────┤        ├──▶ D
        └──▶ C ──┘
```

| Step | Runs after |
|---|---|
| A | — |
| B | A |
| C | A |
| D | B, C |

In a run, A syncs first. When A has succeeded, B and C start together (fan-out). D starts once, after both B and C have succeeded (fan-in). Only the syncs of this run count: a sync of B started with **Sync Now** does not satisfy D.

## Creating a Workflow

1. Go to **Workflows** in the sidebar and click **New workflow**.
2. Enter a **Name**.
3. Set a schedule in the cron editor, or leave it on manual. A workflow without a schedule runs only when you start it. The cron syntax is the one connections use, evaluated in UTC; see [Scheduling & Triggers](/synclet-site/docs/guides/scheduling/#cron-scheduling).
4. Under **Steps**, choose a connection and click **Add step**. Repeat for every connection the workflow runs.
5. For each step, check the steps it **Runs after**. A step with none starts the run. A box that would make a cycle is disabled.
6. Click **Create workflow**.

The server rejects a workflow without a name or without steps, a cycle, a connection listed twice, a connection from another workspace, and a connection without [configured streams](/synclet-site/docs/guides/connections/#streams-are-required-to-run). A connection can be a step of several workflows.

Adding a connection to a workflow turns off the connection's own schedule; see [Schedules](#schedules).

## How a Run Proceeds

A run starts on the workflow's schedule or when an editor clicks **Run now** (or calls `RunWorkflow`). Every step starts the run as pending.

- A step starts when all the steps it runs after have succeeded. Synclet then queues an ordinary sync job for its connection, with the connection's retry policy.
- If the connection already has a sync running or queued, for example one started with **Sync Now**, the step waits for it to end and then queues its own.
- Workflow syncs go through the same queue as other syncs and count toward `PIPELINE_MAX_CONCURRENT_JOBS`. When the limit is reached, ready steps wait for a free slot.
- A step succeeds when its job completes. It fails when its job fails after its last attempt, or is cancelled. A failed attempt that is retried keeps the step running.
- The run ends `succeeded` when no step failed, and `failed` when at least one step failed.

Only one run of a workflow is active at a time. A scheduled start while a run is still active is skipped, and the workflow waits for the next scheduled time. **Run now** and `RunWorkflow` are rejected while a run is active, and when a step's connection has no configured streams; `RerunWorkflowRun` is rejected when a step it would sync again has none.

### When a Step Fails

A failed step marks every step downstream of it `skipped`. Independent branches keep running. In the example, if B fails, D is skipped, C still runs, and the run ends `failed` once C has finished.

A failed run sends a [notification](/synclet-site/docs/guides/notifications/#notification-rules--conditions) to channels with an **On failure** rule on one of the workflow's connections, and the [`workflow.failed` webhook](/synclet-site/docs/guides/webhooks/#events). The step's sync job also sends its own `sync.failed` webhook and sync failure notification, as any failed sync does.

### Disabled and Paused Connections

When a step is ready but its connection is not active (disabled, or [paused by Synclet](/synclet-site/docs/guides/schema-changes/#paused-by-synclet)), the step is skipped with everything downstream of it. A skipped step does not fail the run by itself: a run whose other steps all succeed ends `succeeded`.

A step whose connection has lost its configured streams since the run started fails with the reason "has no configured streams", and everything downstream of it is skipped.

### Rerunning Failed Steps

An editor can rerun a failed run with **Rerun failed steps** in the run history (or `RerunWorkflowRun`). The rerun reuses the same run: its failed and skipped steps go back to pending and run again in order, while steps that succeeded keep their result and are not synced again.

If the workflow changed since the run, a step added since joins the rerun, and a step removed since stays skipped. A rerun is rejected while another run of the workflow is active, and for a run that did not fail.

## Schedules

A connection that is a step of a workflow has no schedule of its own: the workflow runs it.

- Adding a connection to a workflow turns its schedule off. Its **Settings** tab shows "This connection is run by" and the workflow's name in place of the cron editor, and the API rejects setting a schedule on it.
- **Sync Now** still starts a sync of the connection at any time. Such a sync is not part of a workflow run.
- Removing a connection from its last workflow, or deleting the workflow, leaves the connection without a schedule. Set one on its **Settings** tab if it should run on its own again.

## Editing and Deleting

Open the workflow, change its name, schedule or steps, and click **Save workflow**. A step whose connection stays in the workflow keeps its history. Editing and deleting are rejected while a run is active; the page says "A run is in progress; the workflow can be changed once it ends."

**Delete** removes the workflow with its run history. The connections stay.

A connection that is a step of a workflow cannot be deleted. Remove it from every workflow first; see [Deleting a Connection](/synclet-site/docs/guides/connections/#deleting-a-connection).

Workflows are not included in [config export](/synclet-site/docs/guides/settings/#config-export--import).

## The Workflow Page

**Workflows** lists the workspace's workflows with their number of steps, schedule and next scheduled run. A workflow's page has three cards:

- **Definition** — name, schedule and the step list, each step with the steps it **Runs after**.
- **Graph** — a read-only graph of the steps, coloured by their status in the latest run, or in the run picked in the selector or with **Show in graph**. In a running run, a pending step whose upstream steps have all finished shows as *starting* (its job is being queued) and one still waiting on upstream steps as *waiting*.
- **Run history** — every run with its status, trigger (`schedule` or `manual`), start and end times and how many steps succeeded, and **Rerun failed steps** on a failed run.

Step statuses in a run:

| Status | Meaning |
|---|---|
| `pending` | Not started yet. |
| `queued` | Its sync job is queued or running. |
| `succeeded` | Its sync job completed. |
| `failed` | Its sync job failed after its last attempt, or was cancelled. |
| `skipped` | An upstream step did not succeed, or its connection was not active. |

## Roles

Editors and admins create, edit, delete, run and rerun workflows. Viewers see workflows, the graph and the run history, but the page shows no **New workflow**, **Run now**, **Delete** or rerun buttons, and the definition is read-only. See [Workspaces & Roles](/synclet-site/docs/concepts/workspaces-and-roles/) and the [`WorkflowService` RPCs](/synclet-site/docs/reference/api/#workflowservice).

## Next Steps

- [Creating Connections](/synclet-site/docs/guides/connections/) — The connections a workflow runs.
- [Scheduling & Triggers](/synclet-site/docs/guides/scheduling/) — Cron syntax, retries and concurrency.
- [Notifications](/synclet-site/docs/guides/notifications/) — Alerts for failed syncs and workflow runs.
- [Webhooks](/synclet-site/docs/guides/webhooks/) — The `workflow.failed` event and its payload.
