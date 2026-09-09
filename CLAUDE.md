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
parameter with a sensible default. The API stores no configuration. Do not add
server-side config state for these.

**Settings are split by what they belong to.** Alarm limits and analytic tuning
are properties of the *equipment* and live in `machines.thresholds` (Supabase),
shared by everyone who views that machine — a 2 kW fan and a 300 kW compressor
cannot share a vibration limit. Display preferences (time range, refresh,
chart resolution, fault-table scope, idle timeout) are per operator and live in
`user_settings`. The backend stays stateless either way: both halves are still
sent as query parameters.

`GET /api/machines` therefore takes a `limits` parameter — a compact
`id:vib_warn:vib_critical:vib_scale:temp_warn:temp_critical` list, comma
separated — so the fleet roll-up scores each machine against its own limits.
Anything absent falls back to the query-level thresholds, which is what an
older client sending nothing gets.

**Vibration limits come from a standard, not from typed numbers.**
`pdm-frontend/src/lib/standards.js` holds the published zone tables (ISO
10816-1 classes I–IV, ISO 20816-3 / 10816-3 groups × rigid/flexible). A machine
stores which standard and class it uses; `resolveLimits()` derives warning
(B/C boundary) and critical (C/D boundary) from the table, so the numbers can
never drift out of step with the class. Only `standardId: 'custom'` keeps
hand-entered values. The shipped default is ISO 10816-1 Class I, which is where
the original 1.8 / 4.5 mm/s defaults came from.

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

**Charts with alarm lines are scaled to the alarm, not to the data.** A chart
auto-fitted to a quiet signal turns 0.05 mm/s of noise into a dramatic-looking
trace, and operators read the shape of a trace long before they read the axis
numbers. `TimeSeriesChart` therefore keeps the reference lines pulling the
Y domain open (`ifOverflow="extendDomain"`) by default and offers an explicit
Alarm/Fit toggle; fitted charts are marked "zoomed" with an amber axis so a
close-up is never mistaken for a severe reading. Do not make Fit the default.

**Fault diagnosis codes are codes, not measurements.** `fault_x/y/z` are
bucketed with `MAX` (never `AVG` — the mean of code 0 and code 20 is code 10, a
different fault) and drawn as `stepAfter` lines, so no value the sensor never
emitted is ever drawn.

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
- **The fleet query hits InfluxDB Core's Parquet file cap and the whole
  dashboard goes `OFFLINE`.** `GET /api/machines` scans a 7-day window; Core
  never compacts, so a 1 Hz feed crosses the default 432-file limit within a
  day or two. The query then 500s, `run_query()`/the `except` clause turns that
  into `[]`, and every machine renders offline with live data still arriving.
  `INFLUXDB3_QUERY_FILE_LIMIT` (set to `20000` in `docker-compose.yml`) is the
  stopgap; a retention period on `machine_telemetry` is the real fix. Symptom to
  recognise: InfluxDB Explorer shows fresh rows but the dashboard shows nothing
  connected.
- **Containers default to UTC; the flow's `dts` and logs need local time.**
  `TZ: "Asia/Kuala_Lumpur"` is set on `node-red`, `influxdb`, `api`, `grafana`
  and `influxdb-explorer` in `docker-compose.yml`. InfluxDB still stores UTC
  internally (correct) and the React app converts on display; the env var is
  what stops the MQTT payload timestamp and Node-RED log lines being 8 hours
  behind. `postgres` already had it.
- **The acquisition flow writes ~3x per second, not once.** The
  `Aggregate Modbus Registers` join re-emits on most incoming Modbus messages
  rather than once per complete 4-block cycle, so InfluxDB and the MQTT branch
  get duplicate rows/messages sharing a `dts` second. Harmless to correctness
  (InfluxDB keeps them as distinct nanosecond rows) but it inflates the file
  count above and multiplies MQTT traffic — fix the join when the flow is open
  in the editor and node throughput is visible.
- **SQL aggregates return NaN, and `json.dumps` refuses it.** A windowed
  `STDDEV` over its first row has one sample and is undefined; on a perfectly
  flat signal — an idle motor reporting exactly 0.0 — the variance can also land
  a hair below zero and come back NaN. `moving_avg + std_dev * sigma` is then
  NaN and `/anomalies` 500s for a machine that is merely stopped, while a demo
  machine with real variance passes. `_json_safe()` in `run_query()` turns every
  non-finite float into `None` at the serialization boundary; the two routes
  that call `client.query` directly scrub their rows the same way. Never fix
  this by special-casing one query.
- **`text-transform: uppercase` maps `µ` to Greek capital Mu.** Chart titles are
  uppercased in CSS, so "Displacement (µm)" rendered as "(ΜM)" — indistinguishable
  from millimetres, a unit error of 1000×. Spell micron units out in words in
  any uppercased text.
- **Postgres `jsonb` does not preserve key order.** A config saved to
  `machines.thresholds` comes back with its keys rearranged (jsonb sorts by key
  length, then bytewise), so `JSON.stringify(draft) !== JSON.stringify(stored)`
  reported a difference after every successful save and the settings Save bar
  never cleared. Compare with `stableStringify()` from `lib/defaults.js`, never
  raw `JSON.stringify`, whenever one side has been through the database.
- **Derived values must not be persisted.** `effectiveMachineConfig()` folds the
  standard's limits (`vibWarn`, `vibCritical`, `zoneAB`, `source`) onto a config
  for reading and for API calls. Writing that back stores values that are
  recomputed on every read anyway, so a stale copy could outlive a change to the
  zone table — and it was half of the stuck-Save-bar bug. `pickMachineConfig()`
  reduces any config to exactly the storable shape; `saveMachineConfig()` runs
  it on the way in and the settings form compares against
  `storedConfigFor(id)`, not `configFor(id)`.
- **Recharts prints whatever number it is given.** `vib_freq_x` is a register
  divided by 10, which surfaces as `9.624999999999998` in a tooltip.
  `tooltipValueFormatter` in `utils/chartConfig.js` caps at two decimals — well
  beyond the sensors' resolution — and trims trailing zeros so a whole number
  still reads as one. It is hoisted to module scope: a formatter allocated per
  render would run on every mouse move across a chart.
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
  Refresh working — the lint rule enforces it. Non-component helpers belong in
  the `*Store.js` half too.
- The ESLint config forbids synchronous `setState` inside an effect body.
  Derive during render, set state inside a promise or timer callback, or reseed
  a draft by remounting the form with a `key` — `SettingsPage` keys the machine
  form on `machineId` for exactly this reason.
- It also forbids impure calls during render, `Date.now()` included. Read clocks
  in effects and handlers; a "just saved" acknowledgement is a state flag
  cleared by a timer, never a timestamp compared against the clock in the body.
- The location hash is the router: `#/<page>/<machineId>`. A reload therefore
  lands where the operator was, Back works, and a view is worth pasting into a
  message. There is no router dependency — see `useHashRoute` in `App.jsx`.
- Inactivity sign-out lives in `hooks/useIdleLogout.js`. Only real user input
  counts as activity; the dashboard's own 1 Hz polling deliberately does not, or
  an unattended terminal would stay signed in forever. Activity is shared across
  tabs through `localStorage`.
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
