# Synclet Documentation Site

Documentation website for [Synclet](https://github.com/synclet-io/synclet) — a data synchronization platform built on the Airbyte connector protocol.

## Development

```bash
bun install
bun run dev          # http://localhost:4321
bun run build        # Production build to ./dist/
bun run check:links  # Fails on links outside the /synclet-site base or to missing pages
```

## Analytics

The site counts page views with [GoatCounter](https://www.goatcounter.com) when `PUBLIC_GOATCOUNTER_CODE` is set at build time to the site code (the `<code>` in `https://<code>.goatcounter.com`). CI reads it from the repository variable `GOATCOUNTER_CODE`; while it is empty, no analytics script is added to the pages.
