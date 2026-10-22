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
| `MCP_PUBLIC_URL` | `http://localhost:8082` | Base URL AI clients reach the MCP server at. OAuth discovery, client registration and tokens are served there. |
| `MCP_UI_URL` | `AUTH_OIDC_CALLBACK_BASE_URL` | Base URL of the web UI that serves the OAuth consent page, `/oauth/authorize`. The Helm chart always sets it: `mcp.uiUrl`, or else the chart's frontend URL. |

With `MCP_ENABLED=true`, the server answers at `http://<host>:8082/mcp` over Streamable HTTP. It keeps no session state, so any number of server replicas can serve it behind a load balancer.

### Kubernetes (Helm)

```yaml
mcp:
  enabled: true
  writeTools: true
  publicUrl: https://mcp.synclet.example.com   # MCP_PUBLIC_URL
  uiUrl: https://synclet.internal.example.com  # MCP_UI_URL; empty takes the chart's frontend URL
  exposure: shared   # or: separate
```

The chart adds a `<release>-mcp` Service and exposes it in one of two ways, set by `mcp.exposure` for the Ingress and the Gateway API alike. In both, MCP follows the way the server is exposed. The chart's Ingress (`server.ingress`) and Gateway API HTTPRoute (`server.gateway`) can run alone or side by side, so you can migrate from one to the other gradually, and MCP moves along with the UI.


- **`shared`** (default): every enabled main route, the main Ingress and the main HTTPRoute, routes the paths in `mcp.paths` to the MCP Service: by default `/mcp`, the two `/.well-known/oauth-*` paths, `/oauth/register` and `/oauth/token`. MCP shares the UI's host.
- **`separate`**: MCP gets routes of its own that carry only those MCP paths, and the main Ingress and HTTPRoute carry none. Use it to make MCP public while the UI stays behind a VPN (see [Synclet behind a VPN](#synclet-behind-a-vpn)). Each way the server is exposed gets its MCP twin:
  - with `server.ingress.enabled`, a second Ingress, `<release>-mcp`, on `mcp.ingress.hostname` (required). It takes its own `ingressClassName`, `tls`, `tlsSecretName` and `annotations` under `mcp.ingress`;
  - with `server.gateway.enabled`, a second HTTPRoute, `<release>-mcp`, attached to the Gateways in `mcp.gateway.parentRefs` (required), on `mcp.gateway.hostnames` if you list any, with its own `mcp.gateway.timeouts`.

  With both enabled, as during a migration, you get both twins; with neither, only the MCP Service, for you to expose yourself.

Charts up to 0.9.0 named these settings `mcp.ingress.mode` and `mcp.ingress.paths`; later charts read only `mcp.exposure` and `mcp.paths`.

```yaml
mcp:
  enabled: true
  publicUrl: https://mcp.synclet.example.com
  exposure: separate
  gateway:
    parentRefs:
      - name: public-gateway
        namespace: gateway-system
    hostnames:
      - mcp.synclet.example.com
server:
  ingress:
    enabled: false
  gateway:
    enabled: true
    parentRefs:
      - name: private-gateway   # reachable only through the VPN
        namespace: gateway-system
    hostnames:
      - synclet.internal.example.com
```

## Authentication and permissions

A client authenticates in one of two ways:

- **OAuth**: clients that support MCP authorization, such as Claude's custom connectors, sign you in through your browser and get a key for the workspace and access level you pick. Nothing to copy. See [Add Synclet as a connector](#add-synclet-as-a-connector).
- **API key**: a [workspace API key](/docs/guides/authentication/#api-keys) sent as `Authorization: Bearer synclet_sk_…`, for clients configured by hand such as Claude Code.

A request without a key, or with an unknown, revoked or expired key, gets `401 Unauthorized` with a `WWW-Authenticate` header that points OAuth clients to the discovery document.

A key carries its workspace and acts with the role of the user who created it:

- **Viewer** can use the read tools.
- **Editor** and **Admin** can also use the operational and write tools.

A tool the role does not allow returns a `permission_denied` error to the client. Actions taken through MCP are recorded in the [audit log](/docs/guides/settings/#audit-log) like the same actions in the UI or API.

A key issued through OAuth also carries the access level chosen on the consent page: the client lists and calls only the tools of that level, and the user's role applies on top of it. It works only on the MCP server; the public API rejects it.

Create a dedicated key for each AI client, so you can revoke it on its own.

## Add Synclet as a connector

Claude (claude.ai, Claude Desktop and the mobile apps) and other clients that support MCP authorization connect with OAuth: you give them the MCP URL, and they register themselves and send you to Synclet to approve access.

1. In Claude, open **Settings > Connectors**, choose **Add custom connector**, enter a name and the MCP URL, `https://mcp.synclet.example.com/mcp`, and choose **Add**. Leave the OAuth client ID and secret empty: Claude registers itself.
2. Choose **Connect**. Your browser opens Synclet's consent page. Sign in first if needed, with your password or your single sign-on provider as usual.
3. The consent page names the client asking for access. Pick the **workspace** it may use and the **access level**:

   | Level | Allows |
   |---|---|
   | Read | The read tools: list and inspect connections, sources, destinations, jobs, workflows. |
   | Read + actions | Also the operational tools: trigger and cancel syncs, pause and resume connections, run and rerun workflows. |
   | Read + actions + write | Every tool, including creating, editing and deleting entities (when `MCP_WRITE_TOOLS` is on). |

4. Choose **Allow**. The browser returns to Claude, which now lists the Synclet tools. **Deny** returns to Claude without granting anything.

The client gets a key valid for one hour and a refresh token valid for 30 days, and renews the key on its own. Each grant is a single entry in **Settings > API Keys**, with the client's name and the access level; renewing replaces the key rather than adding one. **Revoke** ends the grant: the key stops working at once, the refresh token too, and the client has to ask for consent again. Grants whose refresh token has expired are deleted automatically.

The level is fixed per grant. To change it, revoke the key and connect again.

### Synclet behind a VPN

The client's servers call the MCP server, so the MCP host must be reachable from the internet. Signing in and the consent page only have to be reachable from your browser, so the web UI and API can stay behind a VPN:

| Address | Serves | Reachable from |
|---|---|---|
| `https://mcp.synclet.example.com` (`MCP_PUBLIC_URL`) | `/mcp`, `/.well-known/oauth-*`, `/oauth/register`, `/oauth/token` | The internet (the AI client's servers) |
| `https://synclet.internal.example.com` (`MCP_UI_URL`) | The web UI, the API, sign-in, `/oauth/authorize` and the consent page | Your browser, through the VPN |

Connect to the VPN before choosing **Connect** in the client. The browser opens the consent page on the private address, and the code it returns travels to the client through the browser's redirect, so the client never has to reach the private address. Sign-in, passwords and SSO never leave the private side; the public host only issues and checks keys.

With Helm, set `mcp.exposure: separate`, put the MCP host in `mcp.ingress.hostname` and `mcp.publicUrl`, and the private UI address in `mcp.uiUrl` (or leave it empty to use the chart's frontend URL: `frontend.url`, else `server.publicUrl`). Keep the main Ingress on the VPN-only ingress class. With the Gateway API, put the MCP host in `mcp.gateway.hostnames` and `mcp.publicUrl`, attach `mcp.gateway.parentRefs` to a public Gateway and keep `server.gateway.parentRefs` on a private one.

The public MCP route can also be limited to the addresses the AI client's servers connect from. For Claude's connectors, those are Anthropic's published outbound IP ranges; see [Anthropic's IP addresses](https://platform.claude.com/docs/en/api/ip-addresses) for the current list. With an Ingress, set the restriction through `mcp.ingress.annotations`, for example ingress-nginx's `nginx.ingress.kubernetes.io/whitelist-source-range` with those ranges. With the Gateway API, attach your Gateway implementation's IP-filtering policy (for example an Envoy Gateway `SecurityPolicy` with an authorization rule on client CIDRs) to the `<release>-mcp` HTTPRoute.

## Claude Code

Claude Code supports OAuth: add the server without a header, then run `/mcp` in Claude Code and choose **Authenticate** to open the consent page.

```bash
claude mcp add --transport http synclet https://synclet.example.com/mcp
```

To use an API key instead:

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
| `get_configured_catalog` | A connection's current stream configuration: sync modes, cursor, primary key, selected fields and mappers of each stream |
| `get_discovered_catalog` | The streams the connection's source offers, as last discovered |
| `get_source_catalog` | The streams a source offers, as last discovered; read it before `create_connection` with `streams` |
| `list_connectors`, `get_connector_spec` | Installed connectors and their config spec |
| `get_system_info` | The Synclet version, registration, email and workspace mode, runtime defaults, pipeline settings, and the connected executors with their versions |

**Operational** (Editor):

| Tool | Does |
|---|---|
| `trigger_sync` | Starts a sync of a connection |
| `cancel_job` | Cancels a running or queued job |
| `pause_connection`, `resume_connection` | Pauses or resumes a connection's schedule |
| `run_workflow` | Starts a workflow run |
| `rerun_workflow_run` | Reruns a failed workflow run |

**Write** (Editor, only with `MCP_WRITE_TOOLS=true`):

`create_source`, `update_source`, `create_destination`, `update_destination`, `create_connection`, `update_connection`, `configure_streams`, `configure_stream`, `create_workflow`, `update_workflow`, `delete_source`, `delete_destination`, `delete_connection`, `delete_workflow`.

`create_connection` takes `streams`, in the shape `configure_streams` takes, and configures them in the same call. Read the stream names with `get_source_catalog`. A connection without a configured stream cannot sync, run in a workflow or be added to one. If the source's catalog is not discovered yet, a call with streams fails and creates nothing: retry once discovery finishes.

`configure_streams` replaces a connection's whole stream configuration: a stream left out stops syncing. To change one stream, read `get_configured_catalog`, change that stream and send every stream back. `configure_stream` does this for you: it changes or adds the one stream named by `namespace` and `stream_name`, keeps every other stream as configured, and removes the stream when called with `enabled: false`.

Operational and write tools are marked as not read-only, and the deletes and edits as destructive, so clients such as Claude ask you before each call. Turn write tools off with `MCP_WRITE_TOOLS=false` (`mcp.writeTools: false` in the chart) if an assistant should only observe and operate.

No tool returns a secret value. Source and destination configs come back with secrets replaced by `********`; when an update passes a masked value back unchanged, Synclet keeps the stored secret.
