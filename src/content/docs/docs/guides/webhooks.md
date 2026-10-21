---
title: Webhooks
description: Send sync events to your own HTTP endpoint, signed with HMAC-SHA256.
---

A webhook sends a JSON `POST` to a URL of yours when a sync job finishes. Use it to start downstream work, such as a dbt run after a load, or to feed your own alerting. For Slack, email and Telegram alerts, use [Notifications](/synclet-site/docs/guides/notifications/) instead.

Webhooks belong to a workspace. Only admins can see and manage them: the **Webhooks** tab under **Settings** is hidden from editors and viewers, and every webhook API call requires the Admin role.

## Creating a Webhook

1. Go to **Settings > Webhooks** and click **Create webhook**.
2. Enter the **URL**. It must use `https://`.
3. Select one or more **Events**.
4. Optionally enter a **Secret (optional)**. With a secret, every delivery is signed; see [Verifying Signatures](#verifying-signatures).
5. Click **Create**.

The webhook is enabled when it is created. The list shows its URL, events, status and creation date. Click the **Enabled** / **Disabled** badge, or the power button, to switch it on or off without deleting it.

To change a webhook, click the pencil button. The edit dialog sets the URL, events and **Enabled** flag. Leave **New secret (optional)** blank to keep the current secret, enter a value to replace it (deliveries use the new secret from the moment you save), or check **Stop signing deliveries** to remove it. With no events selected, the webhook receives no deliveries.

Deleting a webhook stops its deliveries immediately.

## Events

| Event | Form label | Sent when |
|---|---|---|
| `sync.completed` | Sync completed | A sync job finishes successfully. |
| `sync.failed` | Sync failed | A sync job fails for good, after its last attempt. A failed attempt that is retried sends nothing. |
| `connection.paused` | Connection paused | Never, in the current release. |
| `schema.changed` | Schema changed | Never, in the current release. |
| `*` | All events | Any of the events above. |

The form offers **Connection paused** and **Schema changed**, and the API accepts them, but Synclet does not send either event yet; only `sync.completed` and `sync.failed` are delivered. A cancelled job sends no event.

## Payload

Every delivery is a `POST` with `Content-Type: application/json` and a body like this:

```json
{
  "event": "sync.failed",
  "timestamp": "2026-10-21T09:14:03.512Z",
  "workspace_id": "6f1c…",
  "connection_id": "b2e4…",
  "connection_name": "Postgres → BigQuery",
  "source_name": "Production Postgres",
  "destination_name": "Analytics BigQuery",
  "job_id": "9a07…",
  "job_type": "Sync",
  "attempt": 3,
  "records_read": 1200,
  "bytes_synced": 524288,
  "duration_ms": 41250,
  "error": "source exited with code 1"
}
```

`sync.completed` and `sync.failed` carry the same fields:

| Field | Description |
|---|---|
| `event` | `sync.completed` or `sync.failed`. |
| `timestamp` | When Synclet built the event, in RFC 3339. |
| `workspace_id`, `connection_id`, `job_id` | IDs of the workspace, connection and job. |
| `connection_name`, `source_name`, `destination_name` | Names of the connection, its source and its destination. |
| `job_type` | `Sync`. |
| `attempt` | Number of the job's latest attempt, starting at 1. |
| `records_read`, `bytes_synced`, `duration_ms` | Stats of the latest attempt. |
| `error` | The job's error message. |

Fields without a value are left out, so a field may be missing: `error` on most successful syncs, `records_read` when nothing was read, and the names and stats if Synclet could not load them when it built the event.

## Verifying Signatures

When the webhook has a secret, each request carries an `X-Synclet-Signature` header: the HMAC-SHA256 of the raw request body, keyed with the secret, as lowercase hex. There is no prefix and no timestamp in the header.

Compute the same HMAC over the body bytes exactly as received, before any JSON parsing, and compare it with the header in constant time:

```python
import hashlib
import hmac

def is_valid(secret: str, body: bytes, signature: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

Without a secret the header is not sent. Synclet stores the secret encrypted and never shows it again.

## Testing a Webhook

Click the send button (**Test delivery**) on a webhook's row. Synclet posts a test event to the URL right away, signed like a real delivery:

```json
{
  "event": "webhook.test",
  "timestamp": "2026-10-21T09:20:41.007Z"
}
```

The toast shows the result: **Test delivered: HTTP 200** for a `2xx` answer, or **Test failed** with the status code (or **no response**) and the error. The test is sent once, without retries, whatever events the webhook subscribes to and whether it is enabled. Each test is recorded in the [audit log](/synclet-site/docs/guides/settings/#audit-log).

## Delivery and Retries

Synclet treats any `2xx` response as delivered. A `3xx` that is not followed to a `2xx`, a `4xx` or `5xx` status, a connection error or a timeout is a failed attempt. A failed delivery is tried again after 1 second, then after 2 seconds, up to `NOTIFY_WEBHOOK_MAX_RETRIES` attempts in total (3 by default). Each request times out after `NOTIFY_WEBHOOK_HTTP_TIMEOUT` (10 seconds by default). After the last failed attempt the event is dropped; Synclet keeps no delivery history.

Webhooks matching an event are called one after another. Both settings are described under [Environment Variables: Email and Webhooks](/synclet-site/docs/reference/environment-variables/#email-and-webhooks).

## Private and Internal Addresses

Synclet refuses webhook URLs that point inside your network. The URL is checked when you save it, when you test it and before every delivery:

- the scheme must be `http` or `https` (the form in the UI asks for `https`);
- the host must resolve, and none of its addresses may be private, loopback, link-local, multicast, shared (`100.64.0.0/10`), documentation or otherwise reserved, for IPv4 and IPv6 alike.

The check is repeated on every connection Synclet opens, so it also holds after a redirect or when a hostname's DNS answer changes. A saved webhook whose URL fails the check is skipped. Webhook requests go out directly and ignore `HTTP_PROXY` and `HTTPS_PROXY`.

To receive webhooks from a Synclet inside a private network, expose the receiver on a public address, for example through a tunnel or a public load balancer.

## Next Steps

- [Notifications](/synclet-site/docs/guides/notifications/) — Slack, email and Telegram alerts on failures.
- [Monitoring & Jobs](/synclet-site/docs/guides/monitoring/) — Open the job a webhook points to.
- [Workspaces & Roles](/synclet-site/docs/concepts/workspaces-and-roles/) — Who can manage webhooks.
