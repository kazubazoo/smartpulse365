# CLAUDE.md

Working notes for Claude Code in this repository.

README.md covers what the project is, its architecture and how to set it up —
read it first for context. This file covers what is **not** obvious from the
code: the invariants that must not be broken, the traps that have already cost
time, and how to verify a change actually works.

## Verifying your work

There is no test suite. A change is not done until it has been exercised against
the running stack.

- **Backend**: `docker compose restart api`, then curl the affected endpoint.
  Check both the populated case and the **empty-database** case — the telemetry
  table does not exist until the first write, and every route must return an
  empty result rather than a 500.
- **Frontend**: `npx eslint src` must be clean, then `npm run build` and reload
  the preview. The lint rules here are strict about React effects and are worth
  obeying rather than silencing.
- **Never report a UI change as working without loading the page.** Several
  bugs in this codebase rendered fine in the code and wrong in the browser.
- Prefer checking the real thing over asserting from the source: resolve ports
  with `docker compose ps`, confirm rows in InfluxDB Explorer, read the response
  body rather than only the status code.

## What the user cares about

- **No fabricated data.** This is a diagnostic tool for real machinery. Never
  invent readings, never zero-fill gaps, never let a machine look healthy on the
  strength of configuration alone. If data is absent, say so in the UI.
- **Operator-facing surface.** The dashboard is for plant operators, not
  engineers. Keep debug readouts, point counts and internal caveats out of it.
- **Say what is unverified.** If something could not be tested (no PLC attached,
  no email delivery), state that plainly rather than implying it works.

## Commands

```bash
# Whole stack
docker compose up -d --build
docker compose logs -f api
docker compose ps

# Frontend — ALWAYS build + preview, never `npm run dev` (see Constraints)
cd pdm-frontend && npm ci && npm run build && npm run preview

# Lint before considering frontend work done
cd pdm-frontend && npx eslint src

# InfluxDB admin
docker compose exec influxdb influxdb3 create token --admin
docker compose exec influxdb influxdb3 query --database machine_telemetry \
    --token "$INFLUXDB3_AUTH_TOKEN" "SELECT * FROM motor_metrics LIMIT 5"
```

There is no test suite. Verify changes by exercising the running stack.

## Ports

Defaults are the conventional ports. **Nothing is auto-detected** — if a host
port is taken, Docker fails to bind rather than choosing another.

| Service | Default | Override in `.env` |
|---|---|---|
| React (vite preview) | 4173 | — (vite flag) |
| FastAPI | 8000 | `API_PORT` |
| InfluxDB 3 Core | 8181 | `INFLUXDB_PORT` |
| InfluxDB 3 Explorer | 8888 / 8889 | `INFLUXDB_EXPLORER_PORT` / `_API_PORT` |
| Node-RED | 1880 | `NODE_RED_PORT` |
| Mosquitto | 1883 / 9001 | `MQTT_PORT` / `MQTT_WS_PORT` |
| Grafana | 3000 | `GRAFANA_PORT` |
| Postgres | 5432 | `POSTGRES_PORT` |

Before assuming a URL, resolve the actual mapping:

```bash
docker compose port node-red 1880
docker compose ps --format "table {{.Service}}	{{.Ports}}"
```

Machine-specific remaps belong in `.env` (gitignored), never in the committed
compose file. `docker-compose.override.yml` is gitignored and reserved for
local-only tweaks; do not commit one.

## Setup on a fresh clone

Full walkthrough in README "Quick start". The order matters, and **the pipeline
produces no data until the Node-RED flow is imported and deployed** (step 5) —
until then every machine is correctly `OFFLINE`. `docker compose up` alone is
not enough.

1. `cp .env.example .env`
2. Create `mosquitto/config/mosquitto.conf`. `mosquitto/` is gitignored, so the
   file is absent on a fresh clone and the `eclipse-mosquitto` image crash-loops
   without it. A minimal anonymous listener on 1883 plus websockets on 9001 is
   enough. MQTT is not on the acquisition path (the flow writes straight to
   InfluxDB and Postgres) but the container should still start.
3. `docker compose up -d influxdb` then
   `docker compose exec influxdb influxdb3 create token --admin` — the token
   cannot be minted before the server runs, and is shown only once. Put it in
   `.env` as `INFLUXDB3_AUTH_TOKEN`.
4. `docker compose up -d --build`.
5. Node-RED (**required**): open :1880, Menu → Import `node-red-flows/flows.json`,
   Deploy. Then edit the config nodes — Modbus client host/port/unit-id, and on
   the **Stream to InfluxDB** server config set Version `2.0`, URL
   `http://influxdb:8181`, Token = the `apiv3_` token, Organization
   `Factory_Module`, Bucket `machine_telemetry`. Set `machineId` in the *Map,
   Scale & Process Buffer* function. Deploy again. Confirm rows land in InfluxDB
   Explorer (:8888); repeated `401 Unauthorized` in the log means the token
   field is empty or wrong.
6. Optional Supabase: run `supabase/schema.sql` in the SQL Editor, then put the
   Project URL and an anon key (the long `eyJ…` JWT is the most compatible) in
   **both** `.env` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`) and
   `pdm-frontend/.env.local` (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
   Create at least one user under Authentication → Users — there is no sign-up
   screen. `docker compose up -d api` to load the API-side vars.
7. `cd pdm-frontend && npm ci && npm run build && npm run preview`

Databases and tables are created automatically on the first write from Node-RED
— no InfluxDB CLI beyond the token step.

`VITE_*` variables are inlined at build time. Changing them requires a rebuild,
not a restart.

## Architecture rules

**The frontend never talks to InfluxDB.** All database access is server-side in
`pdm-backend/main.py`. The browser talks to FastAPI (telemetry) and Supabase
(auth, settings, machine registry) only.

**The backend is stateless.** Every threshold — vibration limits, temperature
limits, anomaly sigma, lookback, health full-scale — arrives as a query
parameter with a sensible default. The API stores no configuration. The
frontend owns the values and persists them per user in Supabase. Two users can
view the same machine under different alarm limits simultaneously. Do not add
server-side config state for these.

**`machine_id` is the join key.** It is an InfluxDB tag written by the Node-RED
flow, the primary key of the Supabase `machines` table, and the path segment in
`/api/machines/{id}/...`. All three must agree or a machine shows no data.

**Rows with a NULL `machine_id`** (written before the tag existed) are
attributed to `DEFAULT_MACHINE_ID`. The API also detects when the column does
not exist at all and drops the filter, so a single-motor deployment that never
writes the tag still works.

## Constraints — do not regress these

**Never use `npm run dev` for this dashboard.** React 19's dev-mode
`performance.measure()` instrumentation accumulates memory outside the V8 heap
and eventually crashes the tab at this data rate. Production build + preview
only.

**Chart performance** (thousands of points at 1 Hz):
- One reused `Intl.DateTimeFormat` instance in `utils/time.js` — never
  construct one inside a `.map()` or a tick callback.
- Timestamps normalised once at ingest, never per render.
- Chart config objects hoisted to module scope.
- `memo()` / `useMemo()` on chart components, `isAnimationActive={false}` on
  every Recharts `Line`.
- Min/max decimation before rendering, preserving spike amplitude.

**InfluxDB 3 Core uses SQL, not Flux.** Flux examples found online do not
apply. Timestamp comparisons need explicit `CAST(... AS TIMESTAMP)`. Time-series
queries must filter by time range and `ORDER BY time ASC` — `ORDER BY time DESC
LIMIT n` without a time filter silently returns only the newest n rows.

**Long windows are bucketed server-side** with `date_bin`, taking `MAX` of
vibration/displacement and `AVG` of everything else, so transient impulses keep
their real amplitude at coarse zoom. Preserve that asymmetry.

**Never fabricate data to fill gaps.** Missing telemetry is rendered as a gap
(`connectNulls={false}`) against an axis that spans the full selected window. In
a vibration-monitoring system a fabricated zero reads as "measured and still"
when the truth is "not measured" — that hides failed sensors.

**Online/offline is data recency, not reachability.** A machine is online when
its newest row is within `ONLINE_WINDOW_SECONDS`. `run_state` separates
`OFFLINE` (nothing arriving) from `IDLE` (arriving, motor stopped) — a dead
sensor must not look like a deliberately stopped machine. Network reachability
is a separate question answered by `POST /api/connectivity/test`.

## Traps already hit here

- **The Node-RED flow is not auto-loaded on a fresh clone.** The container
  starts with an empty workspace; `node-red-flows/flows.json` must be imported
  through the editor (Menu → Import) and deployed. Nothing polls the PLC and
  nothing reaches InfluxDB until then, so every machine reads `OFFLINE` — that
  is correct, not a bug. Connecting the PLC or a passing *Test connection* on
  the Machines page does not start acquisition.
- **Injecting Node-RED credentials via the Admin API does not persist them.**
  `POST /flows` with an inline `credentials` block on a config node is silently
  dropped. The InfluxDB token must be typed into the **Stream to InfluxDB**
  server config in the editor and deployed, or written to
  `node_red_data/flows_cred.json` — plaintext only if `credentialSecret: false`
  is set in `node_red_data/settings.js`, otherwise AES-encrypted with the
  system key from `.config.runtime.json`. Symptom of a missing token: repeated
  `401 Unauthorized` write errors in the Node-RED log while Modbus reads
  themselves succeed.
- **`mosquitto` crash-loops on a fresh clone.** `mosquitto/` is gitignored, so
  `mosquitto/config/mosquitto.conf` is absent and the `eclipse-mosquitto` image
  exits on startup (`Unable to open config file`). Create the file — see
  "Setup on a fresh clone". MQTT is not on the acquisition path, so the rest of
  the stack runs fine meanwhile.
- **`node-red-contrib-influxdb` ignores `msg.tags`.** Tags only reach InfluxDB
  when the payload is `[fields, tags]`. Setting `msg.tags` silently drops them.
- **`{}` is truthy.** `/latest` returns `{}` when there is no data; guarding
  with `{latest && ...}` renders a wall of zeroed gauges that look like real
  readings. Check `Object.keys(x).length`.
- **A missing telemetry table raises, it does not return empty.** Route reads
  through `run_query()`, which turns that specific error into `[]`.
- **Untagged legacy rows partition separately** in the fleet query and can
  clobber a machine's newer row. Keep whichever timestamp is later.
- **Recharts generated no ticks** for an explicit epoch-ms domain; ticks are
  computed in `utils/time.js::timeTicks` instead.
- **Ports are not auto-detected.** Machine-specific remaps go in `.env`, never
  in the committed compose file.

## Grafana

The prototype dashboard is provisioned from `grafana/` on every start; it is not
runtime state. `grafana_data/` is a gitignored volume — never put a dashboard
there expecting it to be shared.

- Dashboard JSON is Grafana's **v2 schema** (`apiVersion: dashboard.grafana.app/v2`,
  `spec.elements` rather than `panels`). Grafana 13 provisions it fine, with a
  harmless `managedFields` warning in the log.
- Datasource UIDs are referenced from inside the dashboard JSON and are pinned
  in the provisioning YAML. Changing one without the other silently breaks panels.
- Changing a provisioning file needs `docker compose restart grafana` — a plain
  `up -d` will not recreate the container and the file is never re-read.
- The `machine_activity_logs` table (Postgres) backs the Motor Status panel and
  is created by `postgres/init/`. That init directory only runs when the
  postgres volume is first created; apply changes by hand to an existing volume.

## MQTT publishing

The acquisition flow publishes to the company broker as a **third branch off
the existing function node's InfluxDB output** — the branch was added by
appending one wire, never by editing the working function. Keep it that way:
InfluxDB stays first in the wire list so it receives the original message
object, and the MQTT function returns a new message rather than mutating `msg`.

- Payload is scaled integers per the Novaflow guideline; factors are in a
  single `SCALE` table at the top of *Build MQTT Payload*.
- `dts` is `YYYY-MM-DD HH:mm:ss`. The source PDF contradicts itself on this
  (its section 2 table shows DD-MM-YYYY); section 6.1 is authoritative.
- Unread registers publish as `null`, never `0`.
- The extended-vibration Modbus read covers **D400-D421** (22 registers):
  acceleration at offsets 0-2, velocity 6-8, chip temp 12, displacement 13-15,
  frequency 16-18, fault codes 19-21.

## Frontend conventions

- Context objects and their hooks live in `contexts/*Store.js`; the provider
  components live in `contexts/*Context.jsx`. Splitting them keeps React Fast
  Refresh working — the lint rule enforces it.
- The ESLint config forbids synchronous `setState` inside an effect body.
  Derive during render, or set state inside a promise callback.
- `panels.js` is declarative chart configuration. Adding a chart means adding an
  object there, not writing a component.

## Security

- The Supabase anon/publishable key is public by design; access is enforced by
  Row Level Security policies in `supabase/schema.sql`, not by hiding it.
- Never request or store the `service_role` key — it bypasses RLS.
- `.env` and `pdm-frontend/.env.local` are gitignored and must stay that way.
- `credentialSecret: false` in `node_red_data/settings.js` stores Node-RED
  credentials unencrypted. Acceptable on a local workstation, not for
  deployment.
- Credentials in `docker-compose.yml` (Postgres `admin`/`admin`, Grafana admin)
  are development defaults and must be rotated before any public deployment.

## Known hardware limitation

`accel_x/y/z` return hard zeros. The WTVB01-485 firmware integrates
acceleration internally to derive velocity but does not expose the raw values.
This was confirmed by controlled substitution testing. The fields are kept in
the payload deliberately, so the gap stays visible rather than silently absent.
Do not "fix" them.

## Demo data

`tools/demo_machine.py` writes synthetic telemetry under its own `machine_id`
(default `demo01`) for showcasing on a bench with no hardware. It is not part of
the pipeline. Never write synthetic data under a real machine's ID.
