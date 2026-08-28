# SmartPulse 365 — Predictive Maintenance Module

A self-contained condition-monitoring dashboard for industrial motors. It polls
a PLC over Modbus TCP, stores the readings as time-series data, scores machine
health against ISO 10816-3, and serves it all through a web dashboard with
per-user alarm thresholds.

Runs entirely on one machine with `docker compose up`. No cloud services are
required — Supabase adds login and shared machine configuration when you want
it, and is optional.

---

## What it does

**Fleet overview.** Every machine on one screen with its run state, health
score, recent anomaly count, temperature and frequency. Click through to
diagnostics.

**Three distinct states.** `RUNNING`, `IDLE` (reporting but stopped) and
`OFFLINE` (nothing arriving) are kept separate, so a dead sensor never looks
like a machine somebody switched off.

**Diagnostics.** Vibration velocity, displacement and dominant frequency per
axis; motor temperature; V/Hz, load, current and torque trends; a composite
health score with plain-language commentary; and a fault-classification history.

**Anomaly detection.** A rolling mean with a ±sigma band computed in SQL.
Sigma, window length and noise floor are all editable from the dashboard.

**Grafana-style time ranges.** 1 minute to 7 days. Short windows tail live at
1 Hz; longer ones are aggregated server-side so a 24-hour view returns ~1,500
points instead of 86,400. Axis labels adapt from seconds to weekday-and-date.

**Everything is tunable from the UI.** Vibration and temperature limits, health
scale, anomaly parameters, chart resolution and gauge ranges — stored per user,
applied server-side.

**Machine management.** Add machines, set names, locations and connection
details from the dashboard, and test whether a PLC is actually reachable before
committing the configuration.

---

## Architecture

```
  WTVB01-485 vibration sensor ──┐
                                │ Modbus RTU
  VFD / inverter drive ─────────┤
                                ▼
                        Inovance Easy320 PLC
                                │  Modbus TCP, polled 1 Hz
                                ▼
                            Node-RED                    acquisition only:
                   join → scale → tag → route           no analytics here
                                │
                                │ 1 Hz, tagged machine_id
                                ▼
                      InfluxDB 3 Core (SQL)             time-series store
                                │
                                │ SQL over HTTP
                                ▼
                       FastAPI (pdm-backend)            all processing:
              health, anomalies, faults, downsampling   stateless
                                │
                                │ JSON
                                ▼
                    React + Vite (pdm-frontend)         rendering only
```

Supabase sits alongside, serving the browser directly for **authentication**,
**per-user settings** and the **shared machine registry**.

### Layer responsibilities

| Layer | Does | Does not |
|---|---|---|
| Node-RED | Reads registers, converts to engineering units, tags with `machine_id`, writes to InfluxDB and Postgres | Any analytics or user-facing content |
| InfluxDB 3 Core | Stores every reading, 1 Hz | Compute beyond SQL aggregation |
| FastAPI | Health scoring, anomaly detection, fault classification, time bucketing | Hold configuration — it is stateless |
| React | Render, and own the settings | Touch the database directly |

**The frontend never talks to InfluxDB.** All database access is server-side, so
the database need not be publicly reachable — only the API does. Keep it that
way if you deploy this.

**The backend holds no configuration.** Thresholds arrive as query parameters
with sensible defaults. Two operators can watch the same machine under different
alarm limits at the same time.

**`machine_id` is the join key** between the Node-RED tag, the Supabase registry
and the API route. All three must agree, or a machine shows no data.

---

## Quick start

Requires Docker Desktop and Node.js 20+.

On a fresh clone the pipeline is **inert until Node-RED is set up** (step 5).
Docker starts every container, but nothing polls the PLC and nothing writes to
InfluxDB until you import and deploy the acquisition flow — so the dashboard
correctly shows every machine `OFFLINE` until then. Registering a machine, or a
passing *Test connection*, does not change this.

### 1. Clone and configure

```bash
git clone https://github.com/kazubazoo/smartpulse365.git
cd smartpulse365
cp .env.example .env
```

### 2. Create the Mosquitto config

`mosquitto/` is gitignored, so `mosquitto/config/mosquitto.conf` does not exist
on a fresh clone. The `eclipse-mosquitto` image exits immediately without it and
Docker restart-loops the container. Create a minimal one:

```bash
mkdir -p mosquitto/config
cat > mosquitto/config/mosquitto.conf <<'EOF'
listener 1883
allow_anonymous true
listener 9001
protocol websockets
persistence true
persistence_location /mosquitto/data/
log_dest stdout
EOF
```

The MQTT broker is infrastructure only — the acquisition flow writes straight to
InfluxDB and Postgres — but the container should still start cleanly.

### 3. Mint the InfluxDB token

The admin token can only be created once the server is running, and is shown
once:

```bash
docker compose up -d influxdb
docker compose exec influxdb influxdb3 create token --admin
# → paste the apiv3_... value into .env as INFLUXDB3_AUTH_TOKEN
```

### 4. Start the stack

```bash
docker compose up -d --build
```

The `machine_telemetry` database and its tables are created automatically on the
first write from Node-RED — no further InfluxDB CLI work.

### 5. Set up Node-RED — required, nothing works without this

`node-red-flows/flows.json` is the portable *definition* of the acquisition
flow; it is not loaded automatically. Import it once:

1. Open http://localhost:1880 → Menu (☰) → **Import** → select
   `node-red-flows/flows.json` → **Import** → **Deploy**.
2. Double-click the **Modbus** client config node (pencil next to the *Server*
   field on any `D…` read node) and set the PLC's **Host**, **Port** (usually
   `502`) and **Unit-Id**.
3. Double-click **Stream to InfluxDB** → pencil next to the *Server* field, and
   set:
   - **Version**: `2.0`
   - **URL**: `http://influxdb:8181`
   - **Token**: the `apiv3_…` token from `.env`
   - **Organization**: `Factory_Module`  **Bucket**: `machine_telemetry`
4. In the **Map, Scale & Process Buffer** function node, set `machineId` to the
   Machine ID you will register (default `motor01`).
5. **Deploy** again.

Watch the debug sidebar and InfluxDB Explorer (http://localhost:8888): rows
tagged with your `machine_id` should appear within a second or two. Writes that
fail with `401 Unauthorized` mean the **Token** field in step 3 is empty or
wrong.

> Node-RED keeps that token in `node_red_data/` (gitignored). Deleting that
> directory loses the credential — re-enter it in step 3 and redeploy.

### 6. Build and open the dashboard

```bash
cd pdm-frontend
npm ci && npm run build && npm run preview     # http://localhost:4173
```

> Use `npm run build && npm run preview`, never `npm run dev`. React 19's
> dev-mode instrumentation leaks memory outside the V8 heap and will eventually
> crash the tab at this data rate.

Without Supabase (see below) the dashboard opens straight to the Overview. Add
the machine on the **Machines** page using the same Machine ID you set in
Node-RED step 4; it flips from `OFFLINE` to `RUNNING`/`IDLE` within 30 seconds
of the first row.

### Services

| Service | Default port | Purpose |
|---|---|---|
| Dashboard | 4173 | React frontend |
| API | 8000 | FastAPI (`/docs` for OpenAPI) |
| Node-RED | 1880 | Modbus acquisition |
| InfluxDB 3 Core | 8181 | Time-series storage |
| InfluxDB 3 Explorer | 8888 | Web GUI to browse and query the data |
| Grafana | 3000 | Prototype dashboard, provisioned automatically |
| Postgres | 5432 | Status/event log |
| Mosquitto | 1883 / 9001 | MQTT broker |

Ports are **not** auto-detected — Docker fails to bind rather than picking
another. If the host already runs Node-RED or an MQTT broker, override in
`.env`:

```
NODE_RED_PORT=1881
MQTT_PORT=1884
MQTT_WS_PORT=9002
```

Every service has an equivalent variable (`API_PORT`, `GRAFANA_PORT`,
`INFLUXDB_PORT`, `POSTGRES_PORT`, `INFLUXDB_EXPLORER_PORT`).

### Grafana prototype dashboard

Grafana was the original visualisation layer, used to prove the predictive-
maintenance approach before the React dashboard was built. It is kept as a
working reference and is **provisioned automatically** — open
http://localhost:3000 (admin/admin) and it lands straight on
*Motor 01 (Testing PM)*, all 16 panels wired up. Nothing to import.

Provisioning lives in `grafana/`:

```
grafana/
├── dashboards/motor01-prototype.json      the dashboard itself
└── provisioning/
    ├── datasources/influxdb.yml           SQL against InfluxDB 3
    ├── datasources/postgres.yml           status log for the Motor Status panel
    └── dashboards/dashboards.yml          loads everything above on startup
```

Datasource UIDs are pinned because the dashboard references them by UID —
change one and you must change both.

Panels read from InfluxDB directly, so they show `No data` until telemetry
arrives, exactly like the React dashboard.


---

## Using it with your own hardware

### 1. Register the machine

On the dashboard's **Machines** page, add a machine. The **Machine ID** is the
identifier that links everything together — pick something stable like
`motor01`. Set the PLC's host and port, then press **Test connection**: it opens
a real socket from the API container and sends a Modbus *Read Holding Registers*
frame, distinguishing a timeout, a refused connection, an unresolvable hostname
and a device that actually answers.

### 2. Point Node-RED at the PLC

Open Node-RED, import `node-red-flows/flows.json` (Menu → Import → Deploy), then
edit the config nodes:

- **Modbus client** — the PLC's **Host** / **Port** / **Unit-Id**.
- **Stream to InfluxDB** (server config, pencil icon) — **Version** `2.0`,
  **URL** `http://influxdb:8181`, **Token** = the `apiv3_…` value from `.env`,
  **Organization** `Factory_Module`, **Bucket** `machine_telemetry`. An empty or
  stale token shows up as repeated `401 Unauthorized` write errors in the log.
- **Map, Scale & Process Buffer** function — set `machineId` to match the
  Machine ID you registered.
- **Deploy**.

The flow reads four register blocks in parallel once per second, joins them,
converts raw integers to engineering units (signed 16-bit reinterpretation for
values that can go negative, byte-swapped IEEE-754 for 32-bit floats), and
writes the result tagged with `machine_id`.

Adapting to different hardware means changing the register map in that one
function node. Nothing downstream needs to know.

### 3. Set your thresholds

The **Settings** page holds vibration and temperature limits, the anomaly
detector's sigma and window, and gauge full-scale values. Set the gauge ranges
to your motor's nameplate ratings so the arcs read meaningfully.

### 4. Confirm it is live

A machine appears as `OFFLINE` with no health score until rows actually arrive —
registry membership alone never makes it look running. Watch InfluxDB Explorer
(port 8888) to confirm rows are landing with the right `machine_id`; the
Overview flips to `RUNNING` within 30 seconds of the first write.

---

## Optional: login and shared configuration

Skip this to run unauthenticated on an isolated plant network.

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL Editor (Dashboard → SQL Editor → New
   query). It creates `user_settings` and `machines` with Row Level Security
   policies restricting each account to its own settings, and seeds
   `motor01`–`motor04`. Safe to re-run.
3. From Project Settings → API copy the **Project URL** and an **anon key** —
   the long `eyJ…` JWT is the most broadly compatible — into **both** places
   (the values must match):
   - `.env` as `SUPABASE_URL` / `SUPABASE_ANON_KEY`
   - `pdm-frontend/.env.local` as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
     (copy it from `pdm-frontend/.env.example`)
4. Under Authentication → Sign In / Providers → Email, turn **Confirm email**
   off for a bench setup and **Allow new users to sign up** off so accounts are
   invite-only. Then create at least one operator under Authentication → Users —
   there is no sign-up screen, so without a user you cannot log in.
5. `docker compose up -d api` (picks up the API-side vars) and rebuild the
   frontend (`npm run build && npm run preview`).

`VITE_*` variables are inlined at **build** time — changing them requires a
rebuild, not a restart.

The anon key is public by design; access is enforced by Row Level Security in
the database, not by hiding the key. Never put the `service_role` key in the
browser.

Once configured, the dashboard requires login, the API rejects unauthenticated
requests, and users get a Profile page with password change plus a
forgot-password flow.

---

## Repository layout

```
smartpulse365/
├── docker-compose.yml       All services
├── Dockerfile.node-red      Node-RED + required palette nodes
├── .env.example             Configuration reference
├── CLAUDE.md                Notes for Claude Code
├── node-red-flows/
│   └── flows.json           Exported acquisition flow
├── pdm-backend/             FastAPI — all queries and processing
│   └── main.py
├── pdm-frontend/            React + Vite dashboard
│   └── src/
│       ├── components/      Charts, cards, pickers
│       ├── contexts/        Auth, settings, machines
│       ├── pages/           Overview, Diagnostics, Machines, Settings, Profile
│       ├── lib/             API client, Supabase client, defaults
│       └── panels.js        Declarative chart configuration
├── grafana/                 Provisioned dashboard and datasources
├── postgres/init/           Schema applied on first database start
├── supabase/schema.sql      Tables and RLS policies
└── tools/demo_machine.py    Optional synthetic data for demos
```

Runtime data directories (`influxdb_data/`, `node_red_data/`, `postgres_data/`,
etc.) are bind-mount volumes, excluded from version control and recreated on
first start. `node-red-flows/flows.json` is committed because it is the portable
*definition* of the flow, not runtime state — re-export it after editing in the
Node-RED editor.

---

## API

All routes are namespaced per machine. Thresholds are query parameters.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness, and whether auth is enforced |
| `GET /api/machines` | Fleet roll-up: state, health, anomaly counts |
| `GET /api/machines/{id}/latest` | Most recent snapshot |
| `GET /api/machines/{id}/history` | Time window, bucketed to a point budget |
| `GET /api/machines/{id}/history/latest` | Delta fetch for live tailing |
| `GET /api/machines/{id}/health` | Health score and status |
| `GET /api/machines/{id}/anomalies` | Rolling mean ± sigma band |
| `GET /api/machines/{id}/root-cause-history` | Fault classification history |
| `POST /api/connectivity/test` | Probe a PLC endpoint over Modbus TCP |

Interactive docs at `http://localhost:8000/docs`.

---

## Notes and limitations

**Acceleration reads zero.** The `accel_x/y/z` registers return hard zeros. The
WTVB01-485 firmware integrates acceleration internally to derive velocity but
does not expose the raw values — confirmed by controlled substitution testing.
The fields are kept in the payload deliberately so the gap stays visible.

**Gaps are shown as gaps.** Missing telemetry is never backfilled with zeros. In
a vibration-monitoring system a fabricated zero reads as "measured and still"
when the truth is "not measured", which hides failed sensors.

**Online is data recency, not reachability.** A machine is online while its
newest reading is younger than `ONLINE_WINDOW_SECONDS` (default 30). Use *Test
connection* to answer the separate question of whether the device is reachable.

**Development credentials.** Postgres (`admin`/`admin`) and the Grafana admin
password are literals in `docker-compose.yml`. Rotate them before any
deployment. Node-RED stores its credentials unencrypted on this configuration.

**The Modbus link is site-local.** If the application tier moves to the cloud,
Node-RED stays on-premises and pushes to a cloud endpoint, or you need a VPN or
edge gateway. That is the main topology decision for a hosted deployment.

**InfluxDB 3 Core uses SQL, not Flux.** Flux examples found online do not apply
here. InfluxDB 2.x was considered for its built-in UI and rejected — the
`date_bin` bucketing and `AVG`/`STDDEV` window functions behind anomaly
detection have no clean Flux equivalent. InfluxDB 3 Explorer provides the GUI
instead, and InfluxDB 3 auto-creates databases and tables on write, so Node-RED
never needs a CLI.
