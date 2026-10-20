---
title: Kubernetes
description: Deploy on Kubernetes with Helm chart.
---

Synclet provides a Helm chart for Kubernetes deployments, supporting both a simple single-pod setup and a distributed architecture where each sync runs as a separate Kubernetes Job.

## Helm Installation

Install from the OCI registry:

```bash
helm install synclet oci://ghcr.io/synclet-io/charts/synclet \
  -f values.yaml \
  --namespace synclet \
  --create-namespace
```

To install a specific version:

```bash
helm install synclet oci://ghcr.io/synclet-io/charts/synclet \
  --version 0.2.0 \
  -f values.yaml \
  --namespace synclet \
  --create-namespace
```

A minimal `values.yaml`:

```yaml
auth:
  jwtSecret: "your-jwt-secret"           # min. 32 bytes
encryption:
  key: "your-base64-encoded-32-byte-key" # base64(32 bytes)
```

These map to the `AUTH_JWT_SECRET` and `SECRET_ENCRYPTION_KEY` environment variables. Generate both with `openssl rand -base64 32`.

The chart includes a built-in PostgreSQL by default. To use an external database, disable the built-in one and configure `externalDatabase`:

```yaml
postgresql:
  enabled: false
externalDatabase:
  host: "db.example.com"
  port: 5432
  user: "synclet"
  password: "password"
  database: "synclet"
  sslmode: require
```

Upgrade after changing values:

```bash
helm upgrade synclet oci://ghcr.io/synclet-io/charts/synclet -f values.yaml -n synclet
```

## Key Helm Values

| Value | Description | Default |
|---|---|---|
| `mode` | Deployment mode: `standalone` or `distributed` | `standalone` |
| `server.replicaCount` | Number of server replicas | `1` |
| `server.resources.requests.cpu` | CPU request | `250m` |
| `server.resources.requests.memory` | Memory request | `512Mi` |
| `server.resources.limits.cpu` | CPU limit | `2` |
| `server.resources.limits.memory` | Memory limit | `1Gi` |
| `server.ingress.enabled` | Enable Ingress resource | `true` |
| `server.ingress.hostname` | Ingress hostname | `synclet.local` |
| `server.ingress.tls` | Enable TLS on Ingress | `false` |
| `server.gateway.enabled` | Create a Gateway API `HTTPRoute` | `false` |
| `server.publicUrl` | URL users reach Synclet at | derived |
| `serviceAccount.annotations` | Annotations on the server and jobs account | `{}` |
| `executor.serviceAccount.create` | Separate executor account (distributed mode) | `true` |
| `pipeline.serviceAccount.create` | Separate connector pod account | `false` |
| `logArchive.backend` | Job log archive: `none`, `filesystem`, `s3`, `gcs` | `none` |
| `logArchive.garage.enabled` | Run the bundled Garage S3 store | `false` |
| `cors.*` | CORS of the public API, see [CORS](#cors) | server defaults |
| `corsAllowAllOrigins` | Deprecated alias of `cors.allowAllOrigins` | unset |
| `extraEnv` | Env vars for every Synclet container, see [Extra environment variables](#extra-environment-variables) | `[]` |
| `server.extraEnv`, `jobs.extraEnv`, `executor.extraEnv` | Env vars for one component, applied after `extraEnv` | `[]` |
| `server.extraEnvFrom`, `jobs.extraEnvFrom`, `executor.extraEnvFrom` | Extra `envFrom` sources (ConfigMap or Secret) | `[]` |

## Standalone vs Distributed

### Standalone mode

A single pod runs the API server, scheduler, and sync executor together. This is the simplest setup and works well for small-to-medium workloads.

```yaml
mode: standalone
server:
  replicaCount: 1
```

When Synclet detects it is running inside Kubernetes, it automatically selects the Kubernetes executor: every sync runs as its own `batchv1.Job` (orchestrator + source + destination containers) rather than via the local Docker daemon. No Docker-in-Docker is required.

### Distributed mode

Three separate Deployments run the server, jobs worker, and executor. The executor launches connector pods as Kubernetes Jobs, giving you native resource isolation and scaling.

```yaml
mode: distributed
server:
  replicaCount: 2     # API replicas (stateless)
```

Benefits of distributed mode:

- **Isolation** -- A failing sync cannot crash the API server.
- **Scaling** -- Kubernetes schedules sync Jobs across the cluster.
- **Resource control** -- Set CPU/memory limits per sync via Helm values.
- **Observability** -- Each sync is a distinct Job with its own logs.

See [Production Checklist](/synclet-site/docs/deployment/production/) for sizing guidance.

## Exposing the Server

By default the chart creates an `Ingress` (`server.ingress.*`, class `nginx`). On clusters that use the Kubernetes Gateway API (Envoy Gateway, GKE Gateway, Istio, Cilium and others) it can create an `HTTPRoute` (`gateway.networking.k8s.io/v1`) attached to a `Gateway` you already run. Both route only to the public server Service; the internal executor API (`<fullname>-internal`) is never exposed.

### Ingress with TLS

Enable TLS on the Ingress with cert-manager:

```yaml
server:
  ingress:
    enabled: true
    hostname: synclet.example.com
    tls: true
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
```

Make sure [cert-manager](https://cert-manager.io/) is installed in your cluster. The Ingress references the `<fullname>-tls` Secret (`server.ingress.tlsSecretName` overrides the name).

### Gateway API

| Value | Description | Default |
|---|---|---|
| `server.gateway.enabled` | Render the `HTTPRoute` | `false` |
| `server.gateway.parentRefs` | Gateways the route attaches to: `name` (required), `namespace`, `sectionName` (listener), `port` | `[]` |
| `server.gateway.hostnames` | Hostnames the route matches; empty matches every hostname of the listener | `[]` |
| `server.gateway.paths` | Path matches (`type`, `value`) | `PathPrefix /` |
| `server.gateway.tls` | The Gateway listener terminates TLS; makes the derived public URL `https` | `false` |
| `server.gateway.timeouts.request`, `server.gateway.timeouts.backendRequest` | Timeouts of the route's rule (e.g. `300s`). Gateways default to short ones (Envoy: 15s) that a connector check, spec or discover pulling its image can exceed; `backendRequest` must not exceed `request` | Gateway default |
| `server.gateway.labels`, `server.gateway.annotations` | Extra metadata on the route | `{}` |
| `server.publicUrl` | URL users reach Synclet at; default for `frontend.url` (invite links) and `oidc.callbackBaseURL` | empty |

When `server.publicUrl` is empty it is derived from `server.ingress.hostname` if only the Ingress is enabled, or from the first `server.gateway.hostnames` entry if only the route is. With both enabled the render fails until `server.publicUrl` is set. `frontend.url` and `oidc.callbackBaseURL` still override it for their own setting.

A minimal `Gateway`, terminating TLS with a certificate Secret in its own namespace:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: shared-gateway
  namespace: gateway-system
spec:
  gatewayClassName: eg               # your implementation's GatewayClass
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: synclet.example.com
      tls:
        mode: Terminate
        certificateRefs:
          - name: synclet-example-com-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              kubernetes.io/metadata.name: synclet   # the release namespace
```

```yaml
server:
  ingress:
    enabled: false
  gateway:
    enabled: true
    parentRefs:
      - name: shared-gateway
        namespace: gateway-system
        sectionName: https
    hostnames:
      - synclet.example.com
    tls: true
```

- **Cross-namespace attachment.** A listener accepts routes only from its own namespace unless `allowedRoutes.namespaces` says otherwise (`Same` by default, or `All`, or `Selector` as above). If the route stays `Accepted=False` with `NotAllowedByListeners`, that is the cause. Check with `kubectl get httproute <fullname> -o yaml`.
- **ReferenceGrant.** The route and its backend, the public Service, are in the release namespace, so attaching the route needs none. You need a `ReferenceGrant` in the Secret's namespace only when a listener's `certificateRefs` points at a Secret in a namespace other than the Gateway's.
- **TLS.** TLS ends at the Gateway (`mode: Terminate`). The chart puts no certificate on the route, and cert-manager annotations go on the `Gateway`, not on the chart. Set `server.gateway.tls: true` (or `server.publicUrl` with `https://`) so invite links and OIDC callbacks use `https`. Keep `auth.secureCookies: true`.
- **Client IPs.** Login and register rate limits trust `X-Forwarded-For` only from `rateLimit.trustedProxies`. Behind a Gateway, set it to the pod CIDR of the data-plane proxies (for Envoy Gateway, the `envoy-*` pods in the controller namespace), not to the ingress controller's.

### Migrating from Ingress to a Gateway

1. Enable the route alongside the Ingress and set `server.publicUrl` to the URL users will end up on. Both objects route to the same Service, either with the old hostname on the Ingress and a new one on the route, or with the same hostname on both:
   ```yaml
   server:
     publicUrl: https://synclet.example.com
     ingress:
       enabled: true
       hostname: synclet.example.com
     gateway:
       enabled: true
       parentRefs: [{name: shared-gateway, namespace: gateway-system, sectionName: https}]
       hostnames: [synclet.example.com]
       tls: true
   ```
2. Check the route through the Gateway's address before any DNS change, e.g. `curl --resolve synclet.example.com:443:<gateway-ip> https://synclet.example.com/`. Make sure the Gateway serves a valid certificate for the hostname.
3. Switch DNS to the Gateway's address and wait for the old TTL to run out.
4. Disable the Ingress (`server.ingress.enabled: false`). `server.publicUrl` can stay or be removed, since the route's first hostname now gives the same URL.

### Removing a Gateway implementation

`helm uninstall` of a Gateway implementation does not remove everything it put in the cluster. Envoy Gateway, for example, leaves the `eg-gateway-helm-certgen:<namespace>` ClusterRole and ClusterRoleBinding, the `envoy-gateway-topology-injector.<namespace>` MutatingWebhookConfiguration and its CRDs, and a `GatewayClass` whose controller is gone keeps its finalizer and never finishes deleting. Remove them in this order:

```bash
kubectl delete gateway --all -n <gateway-namespace>      # before the controller, so it releases the GatewayClass
kubectl delete gatewayclass <class>
helm uninstall eg -n <gateway-namespace>
kubectl delete clusterrole,clusterrolebinding eg-gateway-helm-certgen:<gateway-namespace>
kubectl delete mutatingwebhookconfiguration envoy-gateway-topology-injector.<gateway-namespace>
kubectl delete namespace <gateway-namespace>
# A GatewayClass stuck in Terminating after the controller is gone:
kubectl patch gatewayclass <class> --type merge -p '{"metadata":{"finalizers":null}}'
# CRDs, only when nothing else in the cluster uses them (Gateway API CRDs are shared):
kubectl get crd -o name | grep -E '\.gateway\.envoyproxy\.io$' | xargs kubectl delete
```

## CORS

The `cors` block configures CORS on the public API (`PUBLIC_HTTP_SERVER_CORS_*`). The chart renders only the keys you set; the others keep the server defaults.

| Value | Description | Server default |
|---|---|---|
| `cors.allowAllOrigins` | Accept every origin | `false` |
| `cors.allowedOrigins` | Origin hostnames to accept, without scheme or port | `[]` |
| `cors.allowedOriginGlobs` | Hostname globs; `*` matches one dot-separated label | `[]` |
| `cors.allowedMethods` | Methods allowed in preflight requests | `GET`, `POST`, `HEAD` |
| `cors.allowedHeaders` | Request headers allowed in preflight requests | `["*"]` |
| `cors.exposedHeaders` | Response headers exposed to the browser | `[]` |
| `cors.allowCredentials` | Allow cookies and other credentials | `false` |
| `cors.allowPrivateNetwork` | Answer Private Network Access preflights | `false` |
| `cors.maxAge` | Seconds a browser caches a preflight response | `0` |

Lists are passed to the server comma-separated, so an entry cannot contain a comma. `corsAllowAllOrigins` still works as an alias of `cors.allowAllOrigins`; when both are set, `cors.allowAllOrigins` wins.

```yaml
cors:
  allowedOrigins: [app.example.com]
  allowedOriginGlobs: ["*.example.com"]
  allowCredentials: true
  maxAge: 600
```

## Extra Environment Variables

`extraEnv` adds environment variables to every Synclet container: the server, jobs and executor, and the `migrate` init containers of the server and jobs pods. The connector pods the executor launches do not get them. Entries are Kubernetes `EnvVar` objects, so both `value` and `valueFrom` work.

`server.extraEnv`, `jobs.extraEnv` and `executor.extraEnv` apply to one component and come after `extraEnv`, so a component entry wins over a global entry of the same name. Both are rendered as the container's `env`, which takes precedence over `envFrom`: an entry overrides a key of the chart's ConfigMap or of an `extraEnvFrom` source.

```yaml
extraEnv:
  - name: HTTPS_PROXY
    valueFrom:
      secretKeyRef:
        name: synclet-proxy   # a proxy URL with credentials
        key: url
  - name: NO_PROXY
    value: .svc,.cluster.local
server:
  extraEnv:
    - name: LOG_LEVEL
      value: debug          # overrides the chart's ConfigMap for the server only
```

## Health Checks

The server's startup, liveness and readiness probes call `/live`, `/live` and `/ready` on the `internal` container port (`8081`). Each probe takes `path` and `port` (`server.startupProbe.*`, `server.livenessProbe.*`, `server.readinessProbe.*`); `port` is a container port name (`public`, `internal`) or a number. See [Monitoring: health endpoints](/synclet-site/docs/guides/monitoring/#health-endpoints) for what each one checks.

Images up to 0.4.0 serve only `/health` on the public port. To run such an image with this chart, point the probes there instead of disabling them:

```yaml
server:
  startupProbe:
    path: /health
    port: public
  livenessProbe:
    path: /health
    port: public
  readinessProbe:
    path: /health
    port: public
```

## Service Accounts

`<fullname>` on this page is the release name when it contains "synclet" (`synclet` for `helm install synclet …`), otherwise `<release>-synclet`; `fullnameOverride` replaces it.

The chart's `serviceAccount` is meant for the server and jobs pods, which archive job logs and so may hold bucket permissions through Workload Identity. Two other workloads run under accounts of their own:

- **Executor** (`executor.serviceAccount`, distributed mode). The executor launches connector pods, so it needs the connector-runner Role, but it never touches the log archive: it sends log lines to the server through the executor API and only the server archives them. With `create: true` (the default) the chart renders `<fullname>-executor` and binds it to the connector-runner Role and nothing else. Set `create: false` with a `name` to use an existing account (the chart still binds it), or leave both unset to keep the executor on the chart's account.
- **Connector pods** (`pipeline.serviceAccount`). Every pod the executor creates (sync, check, spec, discover) runs in `k8s.namespace` under the account in `PIPELINE_RUNTIME_SERVICE_ACCOUNT_NAME`, or that namespace's default account when it is empty. With `create: true` the chart renders `<fullname>-connector` in `k8s.namespace` with the given annotations and sets that variable to its name. A source or destination overrides it with `service_account_name` in its runtime config; a sync pod takes the source's override, else the destination's, else the global default. Check, spec and discover pods use the global default. The account gets no RBAC.

Both accounts take `annotations`, which is how Workload Identity binds a cloud identity to a Kubernetes account. Some connectors reach Google Cloud or AWS that way:

```yaml
executor:
  serviceAccount:
    annotations: {}   # usually none: the executor needs no cloud access
pipeline:
  serviceAccount:
    create: true
    annotations:
      # GKE Workload Identity
      iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com
      # EKS IRSA
      # eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/<role>
```

On GKE, grant `roles/iam.workloadIdentityUser` to `serviceAccount:<project>.svc.id.goog[<k8s.namespace>/<fullname>-connector]` as in the [log archive example](#gcs-with-gke-workload-identity). On EKS, the role's trust policy must allow `system:serviceaccount:<k8s.namespace>:<fullname>-connector`.

## Log Archive

`logArchive.*` sets where the logs of finished jobs are stored; while a job runs, its logs are always in PostgreSQL. See [Monitoring: log storage](/synclet-site/docs/guides/monitoring/#log-storage-and-archiving) for how archiving works.

| Value | Description | Default |
|---|---|---|
| `logArchive.backend` | `none`, `filesystem`, `s3` or `gcs` | `none` |
| `logArchive.dir`, `logArchive.persistence.existingClaim` | `filesystem`: directory and a pre-created ReadWriteMany PVC mounted there in the server and jobs pods | `/var/lib/synclet/job-logs`, empty |
| `logArchive.s3.*` | `endpoint`, `region`, `bucket`, `prefix`, `usePathStyle`, `accessKeyID`, `secretAccessKey`, or `existingSecret` with both keys | empty |
| `logArchive.gcs.*` | `bucket`, `prefix`, `credentialsSecret` (key `key.json` by default) | empty |
| `logArchive.garage.*` | The bundled Garage store, see below | `enabled: false` |

### GCS with GKE Workload Identity

No key file is needed. The server and jobs pods run as the chart's Kubernetes service account; bind it to a Google service account that can write the bucket:

```bash
gcloud storage buckets add-iam-policy-binding gs://<bucket> \
  --member "serviceAccount:<gsa>@<project>.iam.gserviceaccount.com" \
  --role roles/storage.objectAdmin

gcloud iam service-accounts add-iam-policy-binding <gsa>@<project>.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:<project>.svc.id.goog[<namespace>/<ksa>]"
```

`<ksa>` is the chart's service account (`<fullname>` unless `serviceAccount.name` is set). Then:

```yaml
serviceAccount:
  annotations:
    iam.gke.io/gcp-service-account: <gsa>@<project>.iam.gserviceaccount.com
logArchive:
  backend: gcs
  gcs:
    bucket: <bucket>
```

Outside Workload Identity, store a service account key in a Secret and set `logArchive.gcs.credentialsSecret`; it is mounted only into the server and jobs pods. The executor and connector pods run under [accounts of their own](#service-accounts), so they get no bucket access.

### Bundled Garage

The chart can run [Garage](https://garagehq.deuxfleurs.fr), a small S3-compatible store, next to Synclet so archiving works without an external bucket:

```yaml
logArchive:
  garage:
    enabled: true
    bucket: synclet-logs        # default
    persistence:
      size: 10Gi                # default; size it for your log volume and retention
      storageClass: ""
```

This selects the `s3` backend and points Synclet at the `<fullname>-garage` Service on port 3900 (region `garage`, path-style). Leave `logArchive.backend` at `none`: combining Garage with another backend fails at render time.

Garage runs as a single-node StatefulSet (replication factor 1) with its metadata and data on one ReadWriteOnce volume. On startup it assigns its own layout, creates the access key and the bucket if they are missing and grants the key read/write on the bucket, so no bootstrap job is involved. Its RPC secret, admin token and S3 key are generated once into the `<fullname>-garage` Secret, which is kept on `helm uninstall` together with the volume: Garage refuses to start if the stored key and the Secret disagree. Delete both to start over, or bring your own Secret with `logArchive.garage.existingSecret` (keys `rpc-secret` as 64 hex chars, `admin-token`, `access-key-id`, `secret-access-key`). The S3 (3900) and admin (3903) ports are exposed only through a ClusterIP Service.

:::caution
Garage is a single replica on one volume: backing up that volume is up to you, and losing it loses the archived logs. For serious production use a managed bucket (S3, R2, GCS) instead.
:::

Garage is AGPL-3.0. The chart runs the unmodified upstream image as a separate service that Synclet talks to over the S3 API, which doesn't affect Synclet's own license.

## Monitoring

### Prometheus ServiceMonitor

If you run the [Prometheus Operator](https://prometheus-operator.dev/), enable the ServiceMonitor:

```yaml
server:
  serviceMonitor:
    enabled: true
    interval: 30s
    labels:
      release: prometheus   # match your Prometheus selector
```

Prometheus then scrapes `/metrics` on the internal Service port. See [Production Checklist](/synclet-site/docs/deployment/production/) for recommended Grafana dashboards and alerting rules.
