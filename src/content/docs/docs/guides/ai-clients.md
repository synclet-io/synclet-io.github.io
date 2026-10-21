---
title: Connect an AI Client
description: Let Claude Code, Claude Desktop and other MCP clients read and operate Synclet.
---

Synclet has a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. An AI client such as Claude Code or Claude Desktop connects to it and can list your connections, read job logs, trigger syncs, run workflows and, if you allow it, create and edit sources, destinations, connections and workflows. Every call runs with the permissions of the API key the client uses.

## Enabling the MCP server

The MCP server is off by default. It runs on its own HTTP server, separate from the web UI and API, so you can expose it on its own address.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_ENABLED` | `false` | Start the MCP server. |
| `MCP_HTTP_SERVER_ADDR` | `0.0.0.0:8082` | Address the MCP server listens on. The endpoint is `/mcp`. |
| `MCP_WRITE_TOOLS` | `true` | Offer the tools that create, edit and delete entities. `false` leaves the read and operational tools only. |

With `MCP_ENABLED=true`, the server answers at `http://<host>:8082/mcp` over Streamable HTTP. It keeps no session state, so any number of server replicas can serve it behind a load balancer.

### Kubernetes (Helm)

```yaml
mcp:
  enabled: true
  writeTools: true
  ingress:
    mode: shared   # or: separate
```

The chart adds a `<release>-mcp` Service and exposes it in one of two ways:

- **`shared`** (default): the main Ingress (or the HTTPRoute, with `server.gateway.enabled`) routes `/mcp` and the two `/.well-known/oauth-*` paths to the MCP Service. One host, one Ingress.
- **`separate`**: a second Ingress, on `mcp.ingress.hostname`, routes only the MCP paths. Use it to make MCP public while the main Ingress stays behind a VPN. It takes its own `ingressClassName`, `tls`, `tlsSecretName` and `annotations` under `mcp.ingress`.

## Authentication and permissions

The MCP server accepts [workspace API keys](/synclet-site/docs/guides/authentication/#api-keys) only, sent as `Authorization: Bearer synclet_sk_…`. A request without a key, or with an unknown, revoked or expired key, gets `401 Unauthorized`.

A key carries its workspace and acts with the role of the user who created it:

- **Viewer** can use the read tools.
- **Editor** and **Admin** can also use the operational and write tools.

A tool the role does not allow returns a `permission_denied` error to the client. Actions taken through MCP are recorded in the [audit log](/synclet-site/docs/guides/settings/#audit-log) like the same actions in the UI or API.

Create a dedicated key for each AI client, so you can revoke it on its own.

## Claude Code

```bash
claude mcp add --transport http synclet https://synclet.example.com/mcp \
  --header "Authorization: Bearer synclet_sk_your_api_key_here"
```

`claude mcp list` then shows `synclet` as connected. For a local instance started with `MCP_ENABLED=true`, use `http://localhost:8082/mcp`.

## Claude Desktop

Claude Desktop connects to remote MCP servers through a local bridge. Add this to `claude_desktop_config.json` (**Settings > Developer > Edit Config**) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "synclet": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://synclet.example.com/mcp",
        "--header", "Authorization: Bearer ${SYNCLET_API_KEY}"
      ],
      "env": { "SYNCLET_API_KEY": "synclet_sk_your_api_key_here" }
    }
  }
}
```

## Tools

Each tool takes the same JSON as the matching API request and returns the API response.

**Read** (any role):

| Tool | Returns |
|---|---|
| `list_connections`, `get_connection` | Connections with status and schedule |
| `list_sources`, `get_source`, `list_destinations`, `get_destination` | Sources and destinations; secret values are masked |
| `list_jobs` | Sync jobs of a connection |
| `get_job` | A job with its attempts and the last `log_lines` lines of its log (default 100, at most 1000) |
| `list_workflows`, `get_workflow`, `list_workflow_runs`, `get_workflow_run` | Workflows, their runs and step runs |
| `get_connection_stats` | Sync statistics of a connection |
| `get_schema_changes` | Pending schema changes of a connection |
| `list_connectors`, `get_connector_spec` | Installed connectors and their config spec |

**Operational** (Editor):

| Tool | Does |
|---|---|
| `trigger_sync` | Starts a sync of a connection |
| `cancel_job` | Cancels a running or queued job |
| `pause_connection`, `resume_connection` | Pauses or resumes a connection's schedule |
| `run_workflow` | Starts a workflow run |
| `rerun_workflow_run` | Reruns a failed workflow run |

**Write** (Editor, only with `MCP_WRITE_TOOLS=true`):

`create_source`, `update_source`, `create_destination`, `update_destination`, `create_connection`, `update_connection`, `configure_streams`, `create_workflow`, `update_workflow`, `delete_source`, `delete_destination`, `delete_connection`, `delete_workflow`.

Operational and write tools are marked as not read-only, and the deletes and edits as destructive, so clients such as Claude ask you before each call. Turn write tools off with `MCP_WRITE_TOOLS=false` (`mcp.writeTools: false` in the chart) if an assistant should only observe and operate.

No tool returns a secret value. Source and destination configs come back with secrets replaced by `********`; when an update passes a masked value back unchanged, Synclet keeps the stored secret.
