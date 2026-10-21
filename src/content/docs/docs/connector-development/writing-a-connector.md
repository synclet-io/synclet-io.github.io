---
title: Writing a connector
description: "Write a Synclet source connector in Go with synclet-go-sdk: spec, check, discover, read, state and the conformance test suite."
---

Synclet's own connectors live in [synclet-io/connectors](https://github.com/synclet-io/connectors), one directory per connector, written in Go on [synclet-go-sdk](https://github.com/synclet-io/synclet-go-sdk) and shipped as Docker images that speak the [Airbyte protocol](https://docs.airbyte.com/platform/understanding-airbyte/airbyte-protocol). This page walks through [`connectors/source-postgres`](https://github.com/synclet-io/connectors/tree/main/connectors/source-postgres), the reference source, from an empty directory to a connector that passes the SDK's conformance suite. [Publishing a connector](/docs/connector-development/publishing-a-connector/) covers releasing it.

The SDK is deliberately small: protocol messages, the source and destination interfaces, catalog and state types, the process runner and a test kit. It has no HTTP, pagination, SQL or retry helpers; a connector uses ordinary Go libraries for those (source-postgres uses [pgx](https://github.com/jackc/pgx)).

## Prerequisites

Go 1.26 or later, Docker (for the image and for testcontainers), [Task](https://taskfile.dev), `jq` and golangci-lint v2. Clone the repository:

```bash
git clone https://github.com/synclet-io/connectors.git
cd connectors
```

## A connector directory

```
connectors/source-postgres/
├── Dockerfile          multi-stage build; ENTRYPOINT is the connector binary
├── meta.json           registry metadata, validated against schema/meta.schema.json
├── spec.json           the spec object the image's `spec` command prints, checked in (task spec)
├── CHANGELOG.md        written by release-please
├── README.md
├── .gitignore          /source-postgres (the go build output)
├── .dockerignore       tests, docs, spec.json, meta.json and the binary stay out of the image context
├── go.mod              module source-postgres; requires github.com/synclet-io/synclet-go-sdk
├── main.go             the Source type and main
├── config.go           Config, applyDefaults, validate
├── spec.go             Spec
├── check.go            Check
├── discover.go         Discover
├── read.go             Read and the STREAM state
├── conn.go, types.go   connection (SSL, SSH tunnel) and Postgres type mapping
├── *_test.go           unit tests, integration tests, the conformance suite
└── testdata/fixture.sql  schema and rows loaded into the test container
```

The directory name is the image name and must start with `source-` or `destination-`. Each connector is its own Go module; `go.mod` names the module after the directory and requires the SDK:

```go
module source-postgres

go 1.26.0

require (
	github.com/jackc/pgx/v5 v5.11.0
	github.com/stretchr/testify v1.12.1
	github.com/synclet-io/synclet-go-sdk v0.4.0
	github.com/testcontainers/testcontainers-go v0.44.0
	github.com/testcontainers/testcontainers-go/modules/postgres v0.44.0
	golang.org/x/crypto v0.58.0
)
```

## Starting a new connector

Work inside your clone of synclet-io/connectors when the connector is meant for that repository: the `task` commands (`task test`, `task build`, `task spec`, `task validate`, ...) run from the clone's root and use its `Taskfile.yml`, `schema/meta.schema.json` and release configuration, so they work only there. Everything else on this page (`go test`, and the plain `docker build` and `docker run` commands under [Image and spec.json](#image-and-specjson)) works in any connector directory that has the `Dockerfile` and `.dockerignore` shown below. Either copy the closest existing connector and rename it (`source-example` is the smallest: one stream of generated rows, no external system):

```bash
cp -r connectors/source-postgres connectors/source-acme
# edit go.mod (module name), the Go code, .gitignore, .dockerignore, meta.json, README.md; empty CHANGELOG.md
```

or start an empty directory:

```bash
mkdir connectors/source-acme && cd connectors/source-acme
go mod init source-acme
go get github.com/synclet-io/synclet-go-sdk@latest      # v0.4.0 at the time of writing
go get github.com/stretchr/testify@latest               # require.NoError and friends in the tests below
# a database source also takes its driver and testcontainers, for example:
# go get github.com/jackc/pgx/v5 github.com/testcontainers/testcontainers-go github.com/testcontainers/testcontainers-go/modules/postgres
cp ../source-postgres/Dockerfile .                      # the image build, unchanged
printf '*_test.go\nREADME.md\nCHANGELOG.md\nspec.json\nmeta.json\n/source-acme\n' > .dockerignore
printf '/source-acme\n' > .gitignore
touch CHANGELOG.md README.md
```

Write the Go files (below), then run `go mod tidy`: until code imports a module, `go get` lists it as `// indirect`, and `tidy` fixes that and adds the test dependencies to `go.sum`. `meta.json` is described in [Publishing a connector](/docs/connector-development/publishing-a-connector/#1-fill-in-metajson); `spec.json` is generated at the end of this page.

The `Dockerfile` every connector in the repository uses, copied as is:

```dockerfile
# syntax=docker/dockerfile:1

# Empty unless the build passes --build-context sdk=<path to synclet-go-sdk>, which
# builds against a local SDK checkout instead of the published module.
FROM scratch AS sdk

FROM golang:1.27-alpine AS builder

WORKDIR /build

COPY go.mod go.sum* ./
COPY --from=sdk / /sdk/
RUN if [ -f /sdk/go.mod ]; then go mod edit -replace github.com/synclet-io/synclet-go-sdk=/sdk && go mod tidy; fi \
 && go mod download

COPY . .
RUN if [ -f /sdk/go.mod ]; then go mod edit -replace github.com/synclet-io/synclet-go-sdk=/sdk && go mod tidy; fi
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -trimpath -ldflags "-s -w" -o /connector .

FROM alpine:3.24
RUN apk --no-cache add ca-certificates

COPY --from=builder /connector /connector

ENV AIRBYTE_ENTRYPOINT=/connector
ENTRYPOINT ["/connector"]
```

and source-postgres's `.dockerignore` (replace the last line with your binary's name):

```
*_test.go
README.md
CHANGELOG.md
spec.json
meta.json
/source-postgres
```

## The interface

A source implements `synclet.Source[C]` from package `github.com/synclet-io/synclet-go-sdk` (imported as `synclet`):

```go
type Source[C any] interface {
	Spec(ctx context.Context) (*ConnectorSpecification, error)
	Check(ctx context.Context, cfg C) error
	Discover(ctx context.Context, cfg C) (*Catalog, error)
	Read(ctx context.Context, cfg C, catalog *ConfiguredCatalog, state *InputState, em *Emitter) error
}
```

`C` is your configuration struct. Before every call the runner decodes the configuration JSON into it with `json.Unmarshal` (unknown keys are ignored), so methods take a typed `cfg`, never a file path. A configuration that does not decode never reaches the connector.

`main` hands the source to the `cli` package, which is the only part of the SDK that touches `os.Args`, stdin, stdout and files:

```go
// main.go
package main

import "github.com/synclet-io/synclet-go-sdk/cli"

// Source is the Postgres source connector.
type Source struct{}

func main() { cli.RunSource(Source{}) }
```

`cli.RunSource` parses the command line (`spec`, `check --config FILE`, `discover --config FILE`, `read --config FILE --catalog FILE [--state FILE]`), reads the files, runs the command and exits: 0 on success, 1 when the command failed, was cancelled or panicked, 2 on a usage error. It cancels `ctx` on SIGTERM and SIGINT and sends anything printed to stdout outside the protocol stream to stderr, so a stray `fmt.Println` cannot corrupt the output.

What the runner does with your return values:

- An error from `Spec`, `Discover` or `Read` becomes one `TRACE` message of type `ERROR` and exit code 1. Wrap an error with `synclet.ConfigError(err)` when the user's configuration or catalog caused it; the trace then carries `failure_type: config_error` instead of `system_error`.
- An error from `Check` becomes a `CONNECTION_STATUS` of `FAILED` with `err.Error()` as its message, and exit code 0. Write that message for the user.
- If `ctx` was cancelled when a method returns, the command fails as cancelled, whatever it returned.

## Configuration

`Config` is a plain struct with JSON tags. source-postgres keeps the keys of Airbyte's source-postgres, so existing configurations carry over:

```go
// config.go
type Config struct {
	Host         string       `json:"host"`
	Port         int          `json:"port"`
	Database     string       `json:"database"`
	Schemas      []string     `json:"schemas"`
	Username     string       `json:"username"`
	Password     string       `json:"password"`
	SSLMode      SSLMode      `json:"ssl_mode"`
	TunnelMethod TunnelMethod `json:"tunnel_method"`
}
```

The SDK neither fills defaults nor validates the configuration against the spec. source-postgres does both itself: `applyDefaults()` (port 5432, schema `public`, SSL mode `prefer`, no tunnel) runs at the top of every method, and `validate()` collects every problem into one error with `errors.Join`, which `connect` returns before dialing.

## Spec

`Spec` returns the connector's capabilities and the JSON schema of its configuration, from which Synclet renders the configuration form:

```go
// spec.go
func (Source) Spec(_ context.Context) (*synclet.ConnectorSpecification, error) {
	return &synclet.ConnectorSpecification{
		DocumentationURL:    "https://github.com/synclet-io/connectors/tree/main/connectors/source-postgres",
		SupportsIncremental: true,
		ProtocolVersion:     "0.5.2",
		SupportedDestinationSyncModes: []synclet.DestinationSyncMode{
			synclet.DestinationSyncModeOverwrite,
			synclet.DestinationSyncModeAppend,
			synclet.DestinationSyncModeAppendDedup,
		},
		ConnectionSpecification: synclet.ConnectionSpecification{
			Title:    "Postgres Source Spec",
			Type:     "object",
			Required: []synclet.PropertyName{"host", "port", "database", "username"},
			Properties: synclet.Properties{Properties: map[synclet.PropertyName]synclet.PropertySpec{
				"host": {
					Title: "Host", Description: "Hostname of the database.",
					PropertyType: typed(synclet.String), Order: order(0),
				},
				"password": {
					Title: "Password", Description: "Password associated with the username.",
					PropertyType: typed(synclet.String), IsSecret: true, Order: order(5),
				},
				// port, database, schemas, username, ssl_mode, tunnel_method ...
			}},
		},
	}, nil
}
```

with two small helpers:

```go
func order(n int) *int { return &n }

func typed(t synclet.PropType) synclet.PropertyType {
	return synclet.PropertyType{Type: synclet.PropTypes{t}}
}
```

- The type constants are `synclet.String`, `synclet.Number`, `synclet.Integer`, `synclet.Object`, `synclet.Array` and `synclet.Null`. There is no boolean constant; write `synclet.PropType("boolean")`. Several types make a nullable property: `synclet.PropertyType{Type: synclet.PropTypes{synclet.Integer, synclet.Null}}` (source-postgres's `nullable` helper in `types.go`).
- `PropertySpec` also has `Format` (`synclet.Date`, `synclet.DateTime`, `synclet.Time`) and, through `PropertyType`, `AirbyteType` (`synclet.TimestampWithTZ`, `synclet.TimestampWOTZ`, `synclet.BigInteger`, `synclet.BigNumber`), plus `Default`, `Examples`, `Properties`, `Required`, `OneOf` and `Const`. The same `PropertySpec` describes record fields in a stream's schema (see Discover).
- `Items`, an array's item schema, is not a `PropertySpec` but a `map[string]any` holding raw JSON schema: `Items: map[string]any{"type": "string"}` (the `schemas` property of source-postgres). `Items: &synclet.PropertySpec{...}` does not compile.
- `IsSecret: true` marks a field Synclet stores encrypted and redacts.
- `Order` sets the field's position in the form.
- Choices with their own fields are a `PropertySpec` of type `object` with `OneOf`; each option has a `Const` discriminator field. See `sslOption` and `tunnelOption` in `spec.go`.

The spec is also checked in as `spec.json`; [generating it](#image-and-specjson) is the last step on this page.

## Check

`Check` proves the configuration reaches the data, and fails with a message the user can act on:

```go
// check.go
func (Source) Check(ctx context.Context, cfg Config) error {
	cfg.applyDefaults()
	d, err := connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer d.close()
	var one int
	if err := d.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		return fmt.Errorf("run a test query: %w", err)
	}
	for _, s := range cfg.Schemas {
		// has_schema_privilege(...): "schema %q does not exist",
		// "user %q has no USAGE privilege on schema %q"
	}
	return nil
}
```

`connect` turns driver errors into plain causes (wrong user name or password, an unreachable host, a missing database, a missing `CONNECT` privilege). Pass `ctx` to every network and database call, so a cancelled check returns promptly.

## Discover

`Discover` returns one `synclet.Stream` per thing the user can sync: here, every table, view, materialized view and foreign table of the configured schemas that the user may `SELECT` from.

```go
// discover.go
func (t *table) stream() synclet.Stream {
	props := make(map[synclet.PropertyName]synclet.PropertySpec, len(t.columns))
	for _, c := range t.columns {
		props[synclet.PropertyName(c.name)] = c.typ.schema()
	}
	s := synclet.Stream{
		Name:               t.name,
		Namespace:          t.schema,
		JSONSchema:         synclet.ObjectSchema(props),
		SupportedSyncModes: []synclet.SyncMode{synclet.SyncModeFullRefresh, synclet.SyncModeIncremental},
	}
	for _, c := range t.primaryKey {
		s.SourceDefinedPrimaryKey = append(s.SourceDefinedPrimaryKey, []string{c})
	}
	return s
}

func (Source) Discover(ctx context.Context, cfg Config) (*synclet.Catalog, error) {
	cfg.applyDefaults()
	d, err := connect(ctx, cfg)
	if err != nil {
		return nil, err
	}
	defer d.close()
	tables, err := loadTables(ctx, d.Conn, cfg.Schemas, "")
	if err != nil {
		return nil, err
	}
	cat := &synclet.Catalog{Streams: make([]synclet.Stream, 0, len(tables))}
	for _, t := range tables {
		cat.Streams = append(cat.Streams, t.stream())
	}
	return cat, nil
}
```

- `Name` and `Namespace` identify the stream; `stream.Descriptor()` returns them as a `synclet.StreamDescriptor`, the key records and state are addressed by.
- `JSONSchema` is raw JSON. `synclet.ObjectSchema` builds `{"type":"object","properties":{...}}` from `PropertySpec`s; you can also hand-write a schema. Every record a read emits must match it. A schema that declares `properties` and does not set `additionalProperties` also allows no undeclared top-level field; a schema that sets `additionalProperties` decides that by its own value.
- `SourceDefinedPrimaryKey` lets Synclet deduplicate; leave it empty when there is no key. Set `SourceDefinedCursor` and `DefaultCursorField` when the source, not the user, decides the cursor (an API's `updated_since`). source-postgres lets the user pick any column, so it sets neither.
- Each column maps to a nullable JSON schema type in `types.go`: integers to `integer`, `numeric` to `number`, `timestamptz` to `string` with format `date-time` and airbyte_type `timestamp_with_timezone`, and so on. The [connector README](https://github.com/synclet-io/connectors/tree/main/connectors/source-postgres#types) has the full table.

## Read

`Read` gets the configured catalog (the streams the user selected, each with a sync mode and cursor), the previous state and an emitter, and returns nil when every stream is done:

```go
// read.go
func (Source) Read(ctx context.Context, cfg Config, catalog *synclet.ConfiguredCatalog, state *synclet.InputState, em *synclet.Emitter) error {
	cfg.applyDefaults()
	d, err := connect(ctx, cfg)
	if err != nil {
		return err
	}
	defer d.close()
	for _, cs := range catalog.Streams {
		if err := readStream(ctx, d.Conn, cfg, cs, state, em); err != nil {
			return err
		}
	}
	return nil
}
```

For each `synclet.ConfiguredStream` the connector looks the table up again, keeps only the columns the stream's `json_schema` names, and fails with `synclet.ConfigError` when the table, a column or the cursor column is gone. Then it streams the rows:

```go
for rows.Next() {
	var record []byte
	var cursor *string
	if err := rows.Scan(&record, &cursor); err != nil {
		return fmt.Errorf("read %s: %w", streamName(desc), err)
	}
	if err := em.Record(desc, json.RawMessage(record)); err != nil {
		return err
	}
	...
}
```

The `*synclet.Emitter` writes the protocol stream, one message per call, and is safe to use from several goroutines:

| Method | Emits |
|---|---|
| `em.Record(desc, data)` | a `RECORD`; `data` is a struct, a map or a `json.RawMessage` passed through verbatim |
| `em.StreamState(desc, state)` | a `STATE` of type `STREAM` for one stream |
| `em.GlobalState(shared, streams)` | a `STATE` of type `GLOBAL` (shared state plus per-stream states) |
| `em.State(msg)` | a `STATE` message as given (any type, `LEGACY` included) |
| `em.Log(level, msg)` | a `LOG` |
| `em.Trace(msg)` | a `TRACE` (estimate, stream status, analytics, or an error for a stream you recover from) |
| `em.Control(config)` | a `CONTROL` with an updated configuration (a refreshed OAuth token) |

Since v0.4.0 a source's emitter counts the records it writes and sets `sourceStats.recordCount` on every `STATE` itself: a `STREAM` state gets its stream's records since that stream's previous `STATE`, a `GLOBAL` or `LEGACY` state every record since the previous `STATE`, so no record is counted by two states. A connector writes no code for it; a destination's emitter passes `STATE` messages on as given.

An error from the emitter means the output is gone; return it. For logging, `synclet.Logger(ctx)` returns a `*slog.Logger` whose records become `LOG` messages at INFO and above:

```go
synclet.Logger(ctx).Warn("cursor field changed, reading the stream from the start",
	"stream", streamName(desc), "saved", strings.Join(saved.CursorField, "."), "configured", field[0])
```

Pass `ctx` to every query and request, and check `ctx.Err()` in loops that do no I/O: the conformance suite fails a read that keeps running after its context is cancelled.

## State and incremental reads

A full-refresh stream reads everything and emits no state. An incremental stream reads from a saved position and emits `STATE` messages; Synclet stores the last one it received after the records before it were written, and passes it to the next read.

source-postgres keeps one STREAM state per stream: the cursor column and the greatest cursor value read, as Postgres renders it in text.

```go
type streamState struct {
	CursorField []string `json:"cursor_field"`
	Cursor      *string  `json:"cursor,omitempty"`
}
```

```json
{"cursor_field": ["updated_at"], "cursor": "2024-01-05 00:00:00+00"}
```

Reading it back: `state.Stream(desc)` returns the raw JSON a previous read saved for that stream, or nil. `state` is never nil; it is empty on the first sync. Decode it into your own struct:

```go
raw := state.Stream(desc)
if raw == nil {
	return q, nil // first read: no lower bound
}
var saved streamState
if err := json.Unmarshal(raw, &saved); err != nil {
	return selectQuery{}, synclet.ConfigError(fmt.Errorf("stream %s: invalid state: %w", streamName(desc), err))
}
if !slices.Equal(saved.CursorField, field) {
	// warn and read from the start
	return q, nil
}
q.from = saved.Cursor
```

The query then reads `WHERE cursor >= $1 ORDER BY cursor`.

`>=` or `>`: a resumed read may start at the saved cursor (`>=`) or just after it (`>`); the SDK and the conformance suite accept both, since neither emits anything older than the saved cursor. With `>`, a row that gets the same cursor value as the last row read, but is committed after the read, is never read. Many rows share a timestamp, so source-postgres uses `>=`: rows equal to the saved cursor are emitted again and none is lost, and a deduplicating destination mode (`append_dedup`) drops the repeats. Use `>` only when no new record can share the saved value, such as an increasing id.

Writing it: emit a STATE after the records it covers, never before. source-postgres checkpoints every 10,000 rows and at the end of each incremental stream, so a sync that fails half-way resumes from the last checkpoint:

```go
if cursor != nil {
	st.Cursor = cursor
}
n++
if incremental && n%checkpointRows == 0 && st.Cursor != nil {
	if err := em.StreamState(desc, st); err != nil {
		return err
	}
}
...
if incremental {
	return em.StreamState(desc, st)
}
```

The state must hold the greatest cursor value emitted so far. source-postgres can assign the cursor of every row (`st.Cursor = cursor`) only because its query has `ORDER BY` the cursor column, so the last row read is the greatest. A source that reads in any other order (most APIs) keeps the maximum itself and writes that to the state; the conformance suite fails a second read that emits records older than the first read's greatest cursor. For example, a stream of API items with an RFC 3339 `updated_at`, filtered after fetching:

```go
type itemsState struct {
	UpdatedAt time.Time `json:"updated_at"`
}

func readItems(ctx context.Context, items []Item, cs synclet.ConfiguredStream, state *synclet.InputState, em *synclet.Emitter) error {
	desc := cs.Stream.Descriptor()
	var saved itemsState
	if raw := state.Stream(desc); raw != nil {
		if err := json.Unmarshal(raw, &saved); err != nil {
			return synclet.ConfigError(fmt.Errorf("stream %s: invalid state: %w", desc.Name, err))
		}
	}
	top := saved.UpdatedAt
	for _, it := range items { // any order
		if err := ctx.Err(); err != nil {
			return err
		}
		if !it.UpdatedAt.After(saved.UpdatedAt) { // > saved: skip what the last read already emitted
			continue
		}
		if err := em.Record(desc, it); err != nil {
			return err
		}
		if it.UpdatedAt.After(top) {
			top = it.UpdatedAt
		}
	}
	return em.StreamState(desc, itemsState{UpdatedAt: top})
}
```

Here `Item` is your record struct with `UpdatedAt time.Time` tagged `json:"updated_at"`. The state is written once, after every record, because a STATE in the middle would hold the maximum of the records so far while later, older records still follow. To checkpoint during such a stream, request the items in cursor order from the API, when it can sort, and checkpoint as source-postgres does.

Which cursor a configured stream uses: when the user picks it (`SourceDefinedCursor` false, as in source-postgres), the configured stream's `cursor_field`. When the source decides it (`SourceDefinedCursor: true` with `DefaultCursorField` set in Discover), the stream's `default_cursor_field`; the configured catalog need not carry a `cursor_field` then, and the conformance suite reads the cursor from `default_cursor_field` even when the configured stream also sets a `cursor_field`. Read the same way in your code: use `cs.CursorField`, and fall back to `cs.Stream.DefaultCursorField` when it is empty (source-postgres's `planStream` does exactly that).

## Tests

Tests use the `testkit` package (`github.com/synclet-io/synclet-go-sdk/testkit`), which runs commands in-process, without a binary or Docker image. The assertions below are [testify](https://github.com/stretchr/testify)'s `require` (`github.com/stretchr/testify/require`, a dependency of the connector's module); `testkit` itself needs no assertion library.

The examples use one small helper from `helpers_test.go`, which turns a config or catalog struct into the JSON a request carries:

```go
func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return b
}
```

Marshaling `Config` works because its JSON tags are the configuration keys.

### Running one command

`testkit.RunSource` runs one `synclet.Request` and returns the parsed messages:

```go
// config_test.go
func TestSpec(t *testing.T) {
	out, err := testkit.RunSource(t.Context(), Source{}, synclet.Request{Command: synclet.CommandSpec})
	require.NoError(t, err)
	require.NoError(t, out.Err)
	spec := out.Spec()
	require.NotNil(t, spec)
	require.True(t, spec.SupportsIncremental)
}
```

`err` is a failure to run or parse; `out.Err` is the error the command returned. `*testkit.Output` has accessors for each kind of message: `Records(desc)`, `States()`, `Logs()`, `ErrorTraces()`, `Spec()`, `ConnectionStatus()`, `Catalog()`, and `NextState()`, which turns a read's last states into the `State` of the next request. A read request carries `Config`, `Catalog` and `State` as JSON:

```go
// helpers_test.go
out, err := testkit.RunSource(t.Context(), Source{}, synclet.Request{
	Command: synclet.CommandRead,
	Config:  mustJSON(t, cfg),
	Catalog: mustJSON(t, cat),
	State:   state,
})
```

`TestIncrementalResume` in `integration_test.go` uses this to read, save the last state, change rows and read again from it.

### Testcontainers

Tests never need real credentials. Database sources start the database in Docker with [testcontainers-go](https://golang.testcontainers.org); source-postgres starts `postgres:16-alpine` loaded with `testdata/fixture.sql`:

```go
// helpers_test.go
func runPostgres(opts ...testcontainers.ContainerCustomizer) (Config, error) {
	ctx := context.Background()
	opts = append([]testcontainers.ContainerCustomizer{
		postgres.WithInitScripts(filepath.Join("testdata", "fixture.sql")),
		postgres.WithDatabase(pgDatabase),
		postgres.WithUsername(pgUser),
		postgres.WithPassword(pgPassword),
		postgres.BasicWaitStrategies(),
	}, opts...)
	ctr, err := postgres.Run(ctx, pgImage, opts...)
	// keep ctr for TestMain to terminate, then:
	host, err := ctr.Host(ctx)
	port, err := ctr.MappedPort(ctx, "5432/tcp")
	return Config{Host: host, Port: int(port.Num()), Database: pgDatabase,
		Username: pgUser, Password: pgPassword, SSLMode: SSLMode{Mode: sslDisable}}, nil
}
```

- `sharedPostgres(t)` starts one container on first use (`sync.Once`) for every test that does not need its own server; `TestMain` terminates the containers after the run.
- Every test that needs Docker calls `needDocker(t)` first, which skips it under `go test -short`. `go test -short ./...` runs everything else without Docker; there are no build tags.
- API sources test against an `httptest` server serving hand-written JSON from `testdata/`; `source-openexchangerates` is the reference ([CONTRIBUTING.md](https://github.com/synclet-io/connectors/blob/main/CONTRIBUTING.md#testing-api-sources-with-recorded-http)).

### The conformance suite

Every source runs `testkit.RunSourceSuite`. It takes a working configuration, a configuration `check` must reject and a configured catalog, and reports every protocol violation through `t.Errorf`:

```go
// integration_test.go
func TestConformance(t *testing.T) {
	cfg := sharedPostgres(t)
	broken := cfg
	broken.Password = "wrong"
	users := discoverStream(t, cfg, "public", "users")
	types := discoverStream(t, cfg, "public", "types")
	view := discoverStream(t, cfg, "public", "user_names")
	full := func(s synclet.Stream) synclet.ConfiguredStream {
		return synclet.ConfiguredStream{Stream: s, SyncMode: synclet.SyncModeFullRefresh, DestinationSyncMode: synclet.DestinationSyncModeOverwrite}
	}

	t.Run("full refresh", func(t *testing.T) {
		testkit.RunSourceSuite(t, Source{}, testkit.SourceSuite{
			Config:       mustJSON(t, cfg),
			BrokenConfig: mustJSON(t, broken),
			Catalog:      &synclet.ConfiguredCatalog{Streams: []synclet.ConfiguredStream{full(users), full(types), full(view)}},
		})
	})
	t.Run("incremental", func(t *testing.T) {
		testkit.RunSourceSuite(t, Source{}, testkit.SourceSuite{
			Config:       mustJSON(t, cfg),
			BrokenConfig: mustJSON(t, broken),
			Catalog:      incrementalCatalog(users, "updated_at"),
		})
	})
}
```

The two helpers it uses, from `helpers_test.go` and `integration_test.go`: `discoverStream` runs `Discover` and picks a stream by namespace and name, and `incrementalCatalog` configures one stream as incremental with the given `cursor_field`:

```go
func discoverStream(t *testing.T, cfg Config, namespace, name string) synclet.Stream {
	t.Helper()
	cat, err := Source{}.Discover(t.Context(), cfg)
	require.NoError(t, err)
	for _, s := range cat.Streams {
		if s.Namespace == namespace && s.Name == name {
			return s
		}
	}
	t.Fatalf("discover: no stream %s.%s", namespace, name)
	return synclet.Stream{}
}

func incrementalCatalog(stream synclet.Stream, cursor string) *synclet.ConfiguredCatalog {
	return &synclet.ConfiguredCatalog{Streams: []synclet.ConfiguredStream{{
		Stream:              stream,
		SyncMode:            synclet.SyncModeIncremental,
		CursorField:         []string{cursor},
		DestinationSyncMode: synclet.DestinationSyncModeAppendDedup,
		PrimaryKey:          [][]string{{"id"}},
	}}}
}
```

A connector without an external system can build the catalog straight from its own `Discover`, as `source-example` does:

```go
func TestConformance(t *testing.T) {
	cat, err := Source{}.Discover(t.Context(), Config{})
	require.NoError(t, err)
	testkit.RunSourceSuite(t, Source{}, testkit.SourceSuite{
		Config:       mustJSON(t, Config{Count: 5}),
		BrokenConfig: mustJSON(t, Config{Count: -1}),
		Catalog: &synclet.ConfiguredCatalog{Streams: []synclet.ConfiguredStream{{
			Stream:              cat.Streams[0],
			SyncMode:            synclet.SyncModeFullRefresh,
			DestinationSyncMode: synclet.DestinationSyncModeOverwrite,
		}}},
	})
}
```

The suite checks that:

- `spec` returns a `connectionSpecification` that is a valid JSON schema;
- `check` succeeds with `Config` and fails, with a message, with `BrokenConfig`;
- `discover` returns streams whose `json_schema` is a valid JSON schema with properties;
- `read` emits records (at least one) only for configured streams, each valid against its stream's `json_schema`, and with no undeclared top-level field when that schema does not set `additionalProperties`; values of a `timestamp_without_timezone` or `time_without_timezone` property carry no zone;
- no record follows its stream's last STATE, and an incremental stream with records emits a STATE;
- every STATE carries `sourceStats.recordCount` equal to the records it covers (a STREAM state its stream's records since that stream's previous STATE, a GLOBAL or LEGACY state every record since the previous STATE); the v0.4.0 emitter sets it, so this needs no connector code;
- every incremental stream's records have a value at the cursor field (the stream's `default_cursor_field` when `SourceDefinedCursor` is set and it is not empty, otherwise the configured `cursor_field`, falling back to `default_cursor_field`), and a second read from the first read's last STATE emits nothing older than the first read's greatest cursor;
- `read` returns within 5 seconds (`testkit.CancelTimeout`) after its context is cancelled at its first message.

`SourceSuite` has optional fields for sources that need them: `State` (the first read's state), `CompareCursor` (how to order cursor values; by default numbers numerically, RFC 3339 timestamps as times, other strings lexically) and `Lookback` (for sources that re-read a window before the saved cursor).

### Running the tests

From the repository root:

```bash
task test CONNECTOR=source-postgres    # go vet ./... and go test ./... -count=1; needs Docker
task lint CONNECTOR=source-postgres    # golangci-lint run ./...
```

or in the connector directory, `go test ./...`, or `go test -short ./...` without Docker. CI runs `go vet`, golangci-lint and `go test -race ./...` for every connector a pull request changes, with Docker available.

## Image and spec.json

The `Dockerfile` (shown in [Starting a new connector](#starting-a-new-connector), the same in every connector of the repository) builds a static binary in `golang:1.27-alpine` and copies it into `alpine:3.24` with `ENTRYPOINT ["/connector"]`. It must build for `linux/amd64` and `linux/arm64`. In the repository clone, run these from its root; they use its `Taskfile.yml`:

```bash
task build CONNECTOR=source-postgres          # docker build -t ghcr.io/synclet-io/connectors/source-postgres:dev connectors/source-postgres
task spec CONNECTOR=source-postgres           # build, then write spec.json
task spec:check CONNECTOR=source-postgres     # fail if spec.json differs from the image's `spec`
```

`spec.json` is not the raw output of `spec` (a JSON line `{"type":"SPEC","spec":{...}}`) but the `spec` object inside it, with sorted keys. Without `task`, for example outside the clone, the same two steps are plain commands, run in the connector directory:

```bash
docker build -t source-acme:dev .
docker run --rm --network none source-acme:dev spec | jq -S 'select(.type == "SPEC") | .spec' > spec.json
```

`task spec` runs the same `docker run ... | jq -S ...` line against the image `task build` tagged (`ghcr.io/synclet-io/connectors/<dir>:dev`).

Run the image by hand with a configuration file:

```bash
docker run --rm -v "$PWD:/data" ghcr.io/synclet-io/connectors/source-postgres:dev check --config /data/config.json
docker run --rm -v "$PWD:/data" ghcr.io/synclet-io/connectors/source-postgres:dev read \
  --config /data/config.json --catalog /data/catalog.json
```

Rerun `task spec` whenever the spec changes; CI fails when `spec.json` is stale. Next: fill in `meta.json` and release the connector, as described in [Publishing a connector](/docs/connector-development/publishing-a-connector/).
