---
title: Workspaces & Roles
description: How Synclet isolates teams in workspaces, what the admin, editor and viewer roles may do, and how to manage workspace members.
---

## Workspaces

A workspace is an **isolated environment** within Synclet. Each workspace has its own sources, destinations, connections, schedules, settings, and API keys. Nothing is shared between workspaces — they are completely independent.

Common use cases for multiple workspaces:

- **Team separation** — Give the marketing team and engineering team their own workspace so they manage their own data pipelines independently.
- **Environment isolation** — Create separate workspaces for development, staging, and production.
- **Client isolation** — If you manage data pipelines for multiple clients, each client gets their own workspace with no visibility into others.

A single user can belong to **multiple workspaces**, each with a different role. Several workspaces need multi-workspace mode; see [Workspace Modes](#workspace-modes).

## Roles

Every workspace member is assigned one of three roles. Roles are scoped to a single workspace — a user can be an Admin in one workspace and a Viewer in another.

### Admin

Full control over the workspace. Admins can manage every aspect of data pipelines and workspace membership.

- Create, edit, and delete sources, destinations, connections, and workflows.
- Trigger and cancel syncs, and run workflows.
- Manage workspace members (invite, change roles, remove).
- Configure workspace settings, notification channels, webhooks, and connector repositories.

### Editor

Can build and operate data pipelines but cannot manage team membership or workspace settings.

- Create, edit, and delete sources, destinations, connections, and workflows.
- Trigger and cancel syncs, and run workflows.
- View logs, job history, and dashboard metrics.
- Cannot invite or remove members, change roles, or modify workspace settings.

### Viewer

Read-only access. Viewers can monitor pipeline status and review logs but cannot make changes.

- View the dashboard, connection status, and sync history.
- View source and destination configurations.
- View logs and job details.
- Cannot create, edit, or delete any resources.
- Cannot trigger or cancel syncs.

## Permissions Summary

| Action | Admin | Editor | Viewer |
|---|:---:|:---:|:---:|
| View dashboard & metrics | &#10003; | &#10003; | &#10003; |
| View sync logs & job history | &#10003; | &#10003; | &#10003; |
| View sources & destinations | &#10003; | &#10003; | &#10003; |
| Create / edit sources | &#10003; | &#10003; | &#10007; |
| Create / edit destinations | &#10003; | &#10003; | &#10007; |
| Create / edit connections | &#10003; | &#10003; | &#10007; |
| Create / edit / run workflows | &#10003; | &#10003; | &#10007; |
| Trigger / cancel syncs | &#10003; | &#10003; | &#10007; |
| Manage connectors (add, update, delete) | &#10003; | &#10003; | &#10007; |
| Create / edit notification rules | &#10003; | &#10003; | &#10007; |
| Create / revoke your own API keys | &#10003; | &#10003; | &#10003; |
| Manage members & invites | &#10003; | &#10007; | &#10007; |
| Workspace settings, config export / import | &#10003; | &#10007; | &#10007; |
| Connector repositories | &#10003; | &#10007; | &#10007; |
| Notification channels & webhooks | &#10003; | &#10007; | &#10007; |
| Audit log | &#10003; | &#10007; | &#10007; |

## Managing Members

### Inviting a Member

1. An admin opens **Settings > Members**, enters the person's email address, picks a role (**Admin**, **Editor** or **Viewer**; **Viewer** is preselected) and clicks **Send Invite**. Without SMTP on the server the button reads **Create Invite** and nothing is emailed.
2. Synclet shows the invitation link, `<FRONTEND_URL>/invite/<token>`, with a copy button. With SMTP configured it also emails the link, with the workspace name, the inviter, the role and the expiry date. Without SMTP, send the link yourself.
3. The invitee opens the link. Signed out, they see who invited them and as what role, and can **Sign in** (with a password or an OIDC provider) or **Create an account**; the email is filled in from the invitation, and after signing in or registering they return to the invitation.
4. Signed in with the invited email, they click **Join Workspace** or **Decline**. Joining adds them with the invited role and switches them to the workspace. Signed in with another email, the page names the invited address and offers **Sign out and switch account**.

An invitation is valid for `WORKSPACE_INVITE_TTL` (7 days by default) and can be accepted once. Inviting an email that already has a pending invitation replaces it: the new role and a fresh expiry apply, and the old link stops working. A person who is already a member cannot be invited.

Pending invitations appear in the members list as **Pending**, or **Expired** once they lapse. **Resend invitation** issues a new link with a fresh expiry, and emails it when SMTP is configured; **Revoke invitation** cancels it, and a revoked, declined or expired link only shows why it no longer works.

### Changing a Role

1. Go to **Settings > Members**.
2. Find the member in the list.
3. Select a new role from the dropdown.
4. The change takes effect immediately.

### Removing a Member

1. Go to **Settings > Members**.
2. Click the remove button next to the member.
3. The member immediately loses access to the workspace and all its resources. Their data and configurations are not deleted — other workspace members can still see and manage them.

## Workspace Modes

`WORKSPACE_MODE` decides whether a Synclet installation has one workspace or many. It is read when the server starts; see [Environment Variables: Workspaces](/docs/reference/environment-variables/#workspaces).

### Single-Workspace Mode

In single-workspace mode (`WORKSPACE_MODE=single`, the default), the API server creates a **default workspace** when it starts, and every user joins it on sign-up: the first user as its **Admin**, later users as **Viewer** (OIDC logins take their role from the provider's role settings, see [Authentication](/docs/guides/authentication/)). This workspace is ready to use immediately — you can start adding sources, destinations, and connections right away.

The UI offers no way to create more workspaces in this mode and shows no workspace selector. Admins can still invite people who have no account yet, but signing up already makes them a **Viewer**, and accepting the invitation afterwards does not change that role; an admin sets the role under **Settings > Members**.

### Multi-Workspace Mode

With `WORKSPACE_MODE=multi`, Synclet creates no workspace at startup and users join none on sign-up. Each workspace is created by a user, who becomes its first **Admin**, and other people join only through invitations. OIDC role settings do not assign workspace roles in this mode.

**Creating a workspace.** A user who belongs to no workspace is sent to **Create your workspace** after signing in: enter a **Workspace name** and click **Create workspace**. To create another one later, open `/create-workspace` in the Synclet UI.

**Joining.** An admin of the workspace invites the person by email, as described in [Inviting a Member](#inviting-a-member). Accepting the invitation adds the workspace to the person's list and switches to it.

**Switching.** The workspace selector sits at the bottom of the sidebar, below **Settings**, and shows the current workspace's name. Pick another workspace from it to switch; every page, setting and API call then applies to that workspace. The browser remembers the last selected workspace.

**Deleting.** An admin can delete the current workspace under **Settings > General > Danger Zone > Delete workspace**. Its sources, destinations, connections and history are deleted with it and cannot be restored.

There is no limit on the number of workspaces.

## Next Steps

- [Authentication](/docs/guides/authentication/) — Configure OIDC single sign-on and user management.
- [Quick Start](/docs/getting-started/quick-start/) — Set up your first sync in under 5 minutes.
- [Architecture Overview](/docs/concepts/architecture/) — Learn how Synclet is structured under the hood.
