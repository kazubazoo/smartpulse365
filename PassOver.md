# PassOver — Predictive Maintenance Module

**Handover notes for the person maintaining this system.**

This file holds the full picture: what every part does, how they connect,
where the code is, how to set it up from nothing, and what to do when something
breaks. It is written so you can maintain the system without having to ask
anyone. `README.md` is the short version; `CLAUDE.md` has the engineering notes
in more depth.

Last updated: 6 October 2026.

---

## Contents

1. [The system in one page](#1-the-system-in-one-page)
2. [What runs where](#2-what-runs-where)
3. [The data flow, step by step](#3-the-data-flow-step-by-step)
4. [Repository map](#4-repository-map)
5. [Setting it up from nothing](#5-setting-it-up-from-nothing)
6. [Day-to-day operation](#6-day-to-day-operation)
7. [Configuration reference](#7-configuration-reference)
8. [The acquisition flow (Node-RED)](#8-the-acquisition-flow-node-red)
9. [The backend (FastAPI)](#9-the-backend-fastapi)
10. [The frontend (React)](#10-the-frontend-react)
11. [Supabase: logins, machines, settings](#11-supabase-logins-machines-settings)
12. [The local services (Grafana and friends)](#12-the-local-services-grafana-and-friends)
13. [How to… (common tasks)](#13-how-to-common-tasks)
14. [Troubleshooting](#14-troubleshooting)
15. [Rules that must not be broken](#15-rules-that-must-not-be-broken)
16. [Known issues and open items](#16-known-issues-and-open-items)
17. [Security](#17-security)
18. [Glossary](#18-glossary)

---

## 1. The system in one page

A motor on the plant floor has a **WTVB01-485 vibration sensor** wired to an
**Inovance PLC**. The PLC also reads the motor's drive (voltage, current,
power, speed, temperature).

This project:

- **collects** those readings once a second (Node-RED),
- **sends** them to the company's systems (MQTT → cloud InfluxDB),
- **reads them back** and analyses them (FastAPI),
- **shows** them to operators on a web dashboard (React).

```
                                    ┌──────────────── COMPANY (remote) ────────────────┐
                                    │                                                   │
 ┌─────────────┐   Modbus TCP   ┌───┴──────┐  MQTT   ┌───────────────┐   ┌────────────┐  │
 │ Inovance PLC│ ─────────────▶ │ Node-RED │ ──────▶ │ Novaflow MQTT │──▶│  Novaflow  │  │
 │ 192.168.0.30│   every 1 s    │  :1880   │         │    broker     │   │   ingest   │  │
 │ + WTVB01-485│                └───┬──────┘         └───────────────┘   └─────┬──────┘  │
 └─────────────┘                    │                                          ▼         │
                                    │                                 ┌────────────────┐ │
                                    │  (local copy)                   │ Cloud InfluxDB │ │
                                    ▼                                 │  2.8, Flux     │ │
                             ┌─────────────┐                          └───────┬────────┘ │
                             │Local Influx │                                  │          │
                             │ 3 Core, SQL │◀── Grafana                       │          │
                             └─────────────┘   (prototype)        └───────────┼──────────┘
                                                                              │ reads only
                                                                              ▼
                       ┌──────────┐   login, machines, settings    ┌──────────────────┐
                       │ Supabase │ ◀────────────────────────────▶ │ React dashboard  │
                       │ (cloud)  │                                │      :4173       │
                       └──────────┘                                └────────┬─────────┘
                                                                            │ /api/...
                                                                   ┌────────▼─────────┐
                                                                   │ FastAPI  :8000   │
                                                                   └──────────────────┘
```

The single most important thing to understand:

> **The dashboard reads only the cloud InfluxDB, and this project never writes
> to it.** The data gets there because Node-RED publishes to Novaflow's MQTT
> broker and *their* ingest stores it. If MQTT stops, the dashboard goes
> OFFLINE — even though Node-RED is happily writing to the local database.

---

## 2. What runs where

| Thing | Where it runs | Who owns it | Used by |
|---|---|---|---|
| Inovance PLC + WTVB01-485 sensor | Plant floor, `192.168.0.30` | Plant | Node-RED |
| Node-RED | Docker on this PC, `:1880` | This repo | — |
| Novaflow MQTT broker | `124.217.236.82:1883` | Novaflow | Novaflow ingest |
| Novaflow ingest | Novaflow's servers | Novaflow | — |
| **Cloud InfluxDB 2.8** | `sm365db.novaplus.my:8086` | Novaflow | **FastAPI** |
| FastAPI backend | Docker on this PC, `:8000` | This repo | Dashboard |
| React dashboard | `npm run preview` on this PC, `:4173` | This repo | Operators |
| Supabase | Supabase cloud | Your Supabase account | Dashboard + API |
| Local InfluxDB 3 Core | Docker, `:8181` | This repo | Grafana only |
| InfluxDB Explorer | Docker, `:8888` | This repo | You, for the local DB |
| Grafana | Docker, `:3000` | This repo | Prototype dashboard |
| Postgres | Docker, `:5432` | This repo | Grafana's status panel |
| Mosquitto (local broker) | Docker, `:1883` | This repo | **Nothing** — see §12 |

Everything in Docker is defined in `docker-compose.yml`. The frontend runs
outside Docker with `npm`.

---

## 3. The data flow, step by step

Follow one reading — the motor's X-axis vibration — from the sensor to the
screen.

### 3.1 Sensor → PLC

The WTVB01-485 sends its registers to the PLC over RS-485. The PLC maps them
into its data registers. X-axis velocity lands in **D406**, as an integer in
hundredths of a mm/s. A reading of `124` means **1.24 mm/s**.

### 3.2 PLC → Node-RED (Modbus TCP, every second)

Node-RED reads four register blocks from the PLC on port 502 (unit id 1):

| Block | Registers | Contents |
|---|---|---|
| Motor status | D210 | `0` E-stop, `1` stopped, `2` running |
| Power & temp | D222–D230 | voltage, current, power, torque, motor temperature |
| Controls & metrics | D4110–D4212 | output frequency, RPM, speed command |
| Extended vibration | D400–D421 | acceleration, velocity, chip temp, displacement, frequency, fault codes |

A **join** node waits for all four, then the **Map, Scale & Process Buffer**
function turns raw registers into real units: D406 `124` ÷ 100 → `vibration_x
= 1.24`. The full register map is in §8.2.

### 3.3 Node-RED → three places

The function's output goes three ways:

1. **Local InfluxDB 3** — measurement `motor_metrics`, tag `machine_id`, real
   units. Only Grafana reads this.
2. **Postgres** — only when the motor *status* changes (a status log for
   Grafana).
3. **Build MQTT Payload** → **Novaflow MQTT broker**. This is the path that
   matters. The payload re-scales every value to an **integer**, as the
   Novaflow guideline requires: `vibration_x = 1.24` × 100 → `motor_VBR_VX =
   124`.

### 3.4 MQTT → cloud InfluxDB (Novaflow's side)

Novaflow's ingest stores the message in bucket
`PREDICTIVE_MAINTAINANCE_MODULE` (yes, "MAINTAINANCE" — that spelling is the
real bucket name), measurement **`MOTOR`**, with tags **`device_id = MOTOR001`**
and `site_id = SITE001`. The value stored is still the **scaled integer**
`124`.

### 3.5 Cloud InfluxDB → FastAPI

When the dashboard asks for data, FastAPI builds a **Flux** query, runs it
against the cloud bucket, and gets back `motor_VBR_VX = 124`. The function
`_row()` looks it up in the `GUIDELINE_FIELDS` table, renames it to
`vibration_x` and divides by 100 → **1.24**. It also renames the `device_id`
tag to `machine_id`.

### 3.6 FastAPI → dashboard

The dashboard receives `{"time": "...Z", "vibration_x": 1.24, ...}` and draws
it.

### Why this matters when debugging

There are **two different schemas** for the same reading:

| | Local InfluxDB 3 | Cloud InfluxDB 2.8 |
|---|---|---|
| Written by | Node-RED directly | Novaflow ingest (from MQTT) |
| Query language | SQL | **Flux** |
| Measurement | `motor_metrics` | `MOTOR` |
| Machine tag | `machine_id = motor01` | `device_id = MOTOR001` |
| X vibration field | `vibration_x = 1.24` | `motor_VBR_VX = 124` |
| Units | real units | **scaled integers** |
| Read by | Grafana | **FastAPI → dashboard** |

If a reading looks 10× or 100× wrong on the dashboard, the scale factor in the
flow's `SCALE` table and the divisor in `GUIDELINE_FIELDS` have drifted apart.

---

## 4. Repository map

```
smartpulse365/
├── .env.example              Template for .env (all server-side settings)
├── .gitignore                .env, data volumes, PassOver.md, …
├── CLAUDE.md                 Engineering notes: rules, traps, how to verify
├── README.md                 Short overview and setup
├── PassOver.md               This file — the full handover guide
├── docker-compose.yml        Every container: ports, env, volumes
├── Dockerfile.node-red       Node-RED + the Modbus/InfluxDB/Postgres palette nodes
│
├── node-red-flows/
│   └── flows.json            The acquisition flow, exported. Import it into Node-RED.
│
├── pdm-backend/              FastAPI service
│   ├── Dockerfile
│   ├── requirements.txt      fastapi, uvicorn, influxdb-client, httpx
│   └── main.py               The whole API in one file (see §9)
│
├── pdm-frontend/             React dashboard (Vite + Tailwind + Recharts)
│   ├── .env.example          Template for .env.local (Supabase URL + key)
│   ├── index.html            Page shell, title, favicon
│   ├── vite.config.js        Build config; proxies /api → localhost:8000
│   ├── eslint.config.js      Lint rules (strict about React effects)
│   ├── package.json
│   ├── public/favicon.svg
│   └── src/
│       ├── main.jsx          Entry point
│       ├── App.jsx           Login gate, providers, hash router, page switch
│       ├── index.css         Theme colours, fonts, slider styling
│       ├── panels.js         Which series each chart plots (declarative)
│       ├── pages/            One file per page (see §10.3)
│       ├── components/       Charts, cards, gauges, inputs (see §10.4)
│       ├── contexts/         Auth, settings and machine-registry state (§10.2)
│       ├── hooks/            useIdleLogout — inactivity sign-out
│       ├── lib/              API calls, Supabase client, defaults, ISO standards, status vocabulary
│       └── utils/            Time formatting, chart styling, decimation
│
├── supabase/
│   └── schema.sql            Tables + Row Level Security + seed. Run in Supabase SQL Editor.
│
├── grafana/                  Prototype dashboard, auto-loaded on start
│   ├── dashboards/motor01-prototype.json
│   └── provisioning/         Datasource + dashboard loader config
│
├── postgres/init/            Creates machine_activity_logs on first start
│
└── tools/
    └── demo_machine.py       Synthetic data → LOCAL store (Grafana only)
```

Gitignored folders you will see locally but never in git: `node_red_data/`
(Node-RED's live state, including the deployed flow and its credentials),
`influxdb_data/`, `postgres_data/`, `grafana_data/`, `influxdb_explorer_data/`,
`mosquitto/`, `pdm-frontend/node_modules/`, `pdm-frontend/dist/`.

---

## 5. Setting it up from nothing

### 5.1 What you need first

- **Docker Desktop**
- **Node.js 22.13+** (20.19+ also works) — `node --version`
- **A read-only token for the cloud InfluxDB bucket.** Log in to
  http://sm365db.novaplus.my:8086 (ask Novaflow for an account), then
  *Load Data → API Tokens → Generate API Token → Custom API Token*, tick
  **Read** for `PREDICTIVE_MAINTAINANCE_MODULE` only.
- **Supabase** project credentials, if you want logins (optional).
- The PC must reach `sm365db.novaplus.my:8086` (and the PLC, if this is the
  acquisition PC).

### 5.2 Minimum: see live data on the dashboard

```bash
git clone https://github.com/kazubazoo/smartpulse365.git
cd smartpulse365

cp .env.example .env
#   Edit .env:
#     INFLUX_TOKEN=<your read-only token>
#     INFLUX_ALLOW_INSECURE=true      ← until the server has HTTPS (see §16)

docker compose up -d --build api

cd pdm-frontend
cp .env.example .env.local           # leave blank for no login
npm ci
npm run build
npm run preview                      # http://localhost:4173
```

Check it worked:

```bash
curl http://localhost:8000/api/health
# {"status":"ok","auth_enabled":false,"telemetry_blocked":null}
```

`telemetry_blocked` must be `null`. If it contains a sentence, read it — it
says exactly what is wrong (usually the insecure flag).

### 5.3 Logins and saved settings (Supabase)

1. In the Supabase dashboard: **SQL Editor → New query**, paste the whole of
   `supabase/schema.sql`, **Run**. It is safe to re-run.
2. **Authentication → Users → Add user** — create at least one account. (A
   *Create account* tab appears on the login screen only if you enable
   sign-ups in Supabase.)
3. **Project Settings → API**: copy the Project URL and the `anon` public key
   (the long `eyJ…` one).
4. Put them in **both** places:
   - `.env` → `SUPABASE_URL=` and `SUPABASE_ANON_KEY=`
   - `pdm-frontend/.env.local` → `VITE_SUPABASE_URL=` and `VITE_SUPABASE_ANON_KEY=`
5. `docker compose up -d api` (loads the new API settings), then **rebuild**
   the frontend: `npm run build`. The `VITE_*` values are baked in at build
   time — a restart is not enough.

Never use the `service_role` key anywhere. It bypasses all security.

### 5.4 The acquisition PC (the one wired to the PLC)

Only one PC needs to do this — the one that polls the PLC.

1. Create `mosquitto/config/mosquitto.conf` (the folder is gitignored, and the
   container crash-loops without it):
   ```
   listener 1883
   allow_anonymous true
   listener 9001
   protocol websockets
   ```
2. `docker compose up -d influxdb`, then mint a token for the **local** store:
   ```bash
   docker compose exec influxdb influxdb3 create token --admin
   ```
   It is shown **once**. Put it in `.env` as `INFLUXDB3_AUTH_TOKEN`.
3. `docker compose up -d --build`
4. Open Node-RED at http://localhost:1880 → **Menu → Import** →
   `node-red-flows/flows.json` → **Deploy**. Nothing is collected until you do
   this; a fresh Node-RED container starts empty.
5. Edit the config nodes (double-click them):
   - **Modbus client**: host `192.168.0.30`, port `502`, unit id `1`.
   - **Stream to InfluxDB** server: Version `2.0`, URL
     `http://influxdb:8181`, Token = the `apiv3_…` token from step 2,
     Organization `Factory_Module`, Bucket `machine_telemetry`. This is the
     *local* store. **Never point this node at the cloud server.**
   - **Novaflow MQTT Broker**: `124.217.236.82`, port `1883`.
6. **Deploy** again.
7. Check: repeated `401 Unauthorized` in the Node-RED debug log means the
   InfluxDB token field is empty or wrong. Credentials typed into Node-RED
   must be typed in the editor — sending them via Node-RED's API silently
   discards them.

---

## 6. Day-to-day operation

### Starting and stopping

```bash
docker compose up -d                 # start everything
docker compose ps                    # what is running, on which ports
docker compose logs -f api           # follow the API log
docker compose restart api           # after changing .env
docker compose down                  # stop everything (data is kept)

cd pdm-frontend && npm run preview   # serve the dashboard
```

### After changing code

| You changed | Do this |
|---|---|
| `pdm-backend/main.py` | Nothing — the API runs with `--reload` and picks it up in ~2 s. Check `docker compose logs api` for a syntax error. |
| `pdm-backend/requirements.txt` | `docker compose up -d --build api` |
| `.env` | `docker compose up -d api` |
| Anything in `pdm-frontend/src` | `npx eslint src`, then `npm run build`, then reload the browser |
| `pdm-frontend/.env.local` | `npm run build` (values are baked in) |
| A Grafana provisioning file | `docker compose restart grafana` |
| The Node-RED flow | Edit in the browser and **Deploy**; export to `node-red-flows/flows.json` to keep it in git |

**Never use `npm run dev`.** React 19's development mode records a
performance measurement on every render; at one update a second it builds up
memory the browser cannot reclaim, and the tab eventually crashes. Production
build plus preview only.

### Pushing changes

Commit and push straight to `main` — this repo does not use feature branches.
Before pushing, make sure no `.env`, `.env.local` or token value is staged:

```bash
git status
git diff --cached | grep -iE "token|apiv3_|eyJ" || echo "clean"
```

---

## 7. Configuration reference

### 7.1 `.env` (repo root — server side)

| Variable | Default | Meaning |
|---|---|---|
| `INFLUX_URL` | `http://sm365db.novaplus.my:8086` | Cloud InfluxDB address |
| `INFLUX_TOKEN` | *(none — required)* | Read-only API token |
| `INFLUX_ORG` | `Novaflow` | InfluxDB organisation |
| `INFLUX_BUCKET` | `PREDICTIVE_MAINTAINANCE_MODULE` | Bucket name |
| `INFLUX_MEASUREMENT` | `MOTOR` | Measurement the ingest writes |
| `INFLUX_ALLOW_INSECURE` | off | Allow the token over plain HTTP to a remote host. Must be `true` today. |
| `INFLUX_SCHEMA` | `guideline` | `native` to read a store already in real units (e.g. a local test DB) |
| `INFLUX_MACHINE_TAG` | `device_id` | Tag that identifies the machine |
| `INFLUX_MAX_LOOKBACK` | `7d` | How far back "latest" and "all history" reach |
| `MACHINES` | `MOTOR001:Motor 01` | Machine list when Supabase is off. `id:Name,id:Name` |
| `DEFAULT_MACHINE_ID` | `MOTOR001` | Machine assumed for untagged rows (native schema only) |
| `ONLINE_WINDOW_SECONDS` | `30` | A machine is online if its newest row is younger than this |
| `ANOMALY_WINDOW_SECONDS` | `3600` | Window for the Overview's anomaly count |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | blank | Set both to require login on the API |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Browser origins allowed to call the API |
| `INFLUXDB3_AUTH_TOKEN` | blank | Token for the **local** store (Node-RED, Grafana) |
| `*_PORT` | conventional ports | Host-port overrides, only if a port is taken |

The defaults for the `INFLUX_*` values live in **one place**: the top of
`pdm-backend/main.py`. `docker-compose.yml` passes blanks through, and a blank
means "use the default".

### 7.2 `pdm-frontend/.env.local` (frontend)

| Variable | Meaning |
|---|---|
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` |

Both blank → no login screen, and settings are kept in the browser only.

### 7.3 Settings an operator changes in the dashboard

These are **not** in any file — they are saved in Supabase:

- **Per machine** (Settings → Machine configuration, shared by everyone):
  vibration standard and class, temperature limits, anomaly tuning, gauge
  full-scale values. Stored in `machines.thresholds`.
- **Per operator** (Settings → Display preferences, private): default time
  range, refresh rate, chart resolution, fault-table size and scope, idle
  sign-out time. Stored in `user_settings.settings`.

The API stores none of this. The dashboard sends the relevant values as query
parameters on every request.

---

## 8. The acquisition flow (Node-RED)

File: `node-red-flows/flows.json`. The live, deployed copy is inside
`node_red_data/` (gitignored); export from the editor to update the repo copy.

### 8.1 Nodes and wiring

```
D210: Motor Status ─────────────────┐
D222-D230: Power & Temp ────────────┤
D4110-D4212: Controls & Metrics ────┼─▶ Aggregate Modbus Registers (join)
D400-D421: Extended Vibration ──────┘            │
                                                  ▼
                                 Map, Scale & Process Buffer (function)
                                  │ output 1                   │ output 2
                    ┌─────────────┴─────────────┐              ▼
                    ▼                           ▼        Filter Status Change (rbe)
           Stream to InfluxDB      Build MQTT Payload (Guideline v1.0)      │
           (LOCAL store)                        │                           ▼
                                  ┌─────────────┴─────────┐      Format Postgres SQL
                                  ▼                       ▼                 │
                    Publish to Novaflow Broker   MQTT payload (inspect)     ▼
                                                     (debug)       Commit Log to Postgres
```

- Each Modbus read runs every **1 second**.
- **Filter Status Change** (an `rbe` "report by exception" node) passes a
  message only when the status *changes*, so Postgres gets one row per change,
  not one per second.
- Output 1 is wired to InfluxDB **first** and the MQTT builder second. Keep it
  that way: the MQTT function was added by appending one wire, and it builds a
  new message rather than modifying the one InfluxDB receives.

### 8.2 Register map

From *Map, Scale & Process Buffer*:

| Register | Field | Conversion | Unit |
|---|---|---|---|
| D210 | `status_code` | as-is | 0 E-stop / 1 stopped / 2 running |
| D222 | `voltage` | as-is | V |
| D223 | `current` | ÷ 100 | A |
| D224 | `power` | ÷ 10 | kW |
| D225 | `torque` | ÷ 10 | % |
| D230 | `temperature` | as-is | °C (motor body) |
| D4110–D4111 | `frequency` | 32-bit float, word-swapped | Hz |
| D4112–D4113 | `rpm` | 32-bit float, word-swapped | rpm |
| D4212 | `speed_command_hz` | ÷ 200, forced to 0 when stopped | Hz |
| D400–D402 | `accel_x/y/z` | signed ÷ 32768 × 16 | g — **always 0**, see §16 |
| D406–D408 | `vibration_x/y/z` | ÷ 100 | mm/s |
| D412 | `sensor_chip_temp` | signed ÷ 100 | °C (sensor chip, not motor) |
| D413–D415 | `disp_x/y/z` | as-is | µm |
| D416–D418 | `vib_freq_x/y/z` | ÷ 10 | Hz |
| D419–D421 | `fault_x/y/z` | as-is | diagnosis code |

### 8.3 The MQTT payload

Built by *Build MQTT Payload (Guideline v1.0)*. Topic `pmm/SITE001/MOTOR001`,
QoS 1, not retained. Shape:

```json
{
  "site_id": "SITE001",
  "device_type": "MOTOR",
  "device_id": "MOTOR001",
  "dts": "2026-10-06 10:41:34",
  "data": { "motor_status": 1, "motor_VBR_VX": 124, "...": "..." }
}
```

`dts` is local time, `YYYY-MM-DD HH:mm:ss` (section 6.1 of the guideline is
authoritative; its section 2 contradicts it).

Every value is `round(real_value × factor)`, from the `SCALE` table at the top
of that function:

| Payload field | Dashboard field | Factor |
|---|---|---|
| `motor_status` | `status_code` | 1 |
| `motor_frequency` | `frequency` | 100 |
| `motor_RPM` | `rpm` | 10 |
| `motor_temperature` | `temperature` | 1 |
| `motor_volt` | `voltage` | 1 |
| `motor_amp` | `current` | 100 |
| `motor_power` | `power` | 10 |
| `motor_torque` | `torque` | 10 |
| `motor_VBR_chiptemp` | `sensor_chip_temp` | 100 |
| `motor_VBR_VX/VY/VZ` | `vibration_x/y/z` | 100 |
| `motor_VBR_AX/AY/AZ` | `accel_x/y/z` | 1000 (milli-g) |
| `motor_VBR_DX/DY/DZ` | `disp_x/y/z` | 1 |
| `motor_VBR_FX/FY/FZ` | `vib_freq_x/y/z` | 10 |
| `motor_VBR_faultX/Y/Z` | `fault_x/y/z` | 1 |
| `invt_bus_volt` | — | always `null` (register not read) |

**This table and `GUIDELINE_FIELDS` in `main.py` must always match.** Change
one, change the other in the same commit.

Note that `speed_command_hz` is **not** in the payload, so it never reaches the
cloud and the dashboard cannot show it.

### 8.4 Two machine IDs

The function sets `machineId = "motor01"` — that tags the **local** store.
The MQTT builder sets `DEVICE_ID = "MOTOR001"` — that is what the cloud, and
so the dashboard, uses. They are independent. For the dashboard, only
`MOTOR001` matters.

---

## 9. The backend (FastAPI)

Everything is in `pdm-backend/main.py`, top to bottom in this order. Function
names are given rather than line numbers, which drift.

### 9.1 Sections of `main.py`

| Section | Key names | What it does |
|---|---|---|
| App + CORS | `app`, `ALLOWED_ORIGINS` | FastAPI instance; which browser origins may call it |
| InfluxDB config | `INFLUX_URL`, `INFLUX_BUCKET`, `MEASUREMENT`, `MAX_LOOKBACK` | Connection settings and their defaults |
| Transport check | `_transport_warning`, `INSECURE_TRANSPORT` | Refuses to send the token in cleartext to a remote host |
| Client | `_influx`, `_query_api` | The InfluxDB 2.x client (certificate verification on) |
| Machine registry | `_parse_machines`, `_has_machine_tag`, `machine_filter` | Machine list fallback; the Flux filter for one machine |
| Auth | `require_user` | Checks the Supabase login token (cached 60 s) |
| Field sets | `PEAK_FIELDS`, `AVG_FIELDS`, `ALL_FIELDS` | Which fields are bucketed with MAX vs MEAN |
| Schema translation | `GUIDELINE_FIELDS`, `MACHINE_TAG`, `_source_name`, `_source_limit` | Cloud names/scale ↔ dashboard names/units |
| Thresholds | `Thresholds`, `thresholds` | Alarm limits from query parameters |
| Health | `compute_health` | Scores one reading (§9.4) |
| Query plumbing | `_row`, `run_flux`, `_field_match`, `_field_filter`, `_stream`, `_PIVOT` | Builds and runs Flux, decodes rows |
| Statistics | `_rolling_bounds`, `_peak_rows` | Anomaly band, peak of three axes |
| Routes | see §9.2 | |
| Connectivity probe | `_modbus_probe`, `test_connectivity` | Is the PLC reachable? |

### 9.2 Endpoints

All under `/api`. When Supabase is configured, every route except `/health`
requires `Authorization: Bearer <supabase access token>`.

| Method + path | Parameters | Returns |
|---|---|---|
| `GET /api/health` | — | `{status, auth_enabled, telemetry_blocked}` |
| `GET /api/machines` | `ids`, `limits`, `sigma`, `lookback`, `anomaly_floor`, thresholds | One entry per machine: online, run_state, health, latest key readings, anomaly count |
| `GET /api/machines/{id}/latest` | — | The newest reading as one row, or `{}` |
| `GET /api/machines/{id}/history` | `seconds` (≤ 7 days), `max_points` | `{bucket_seconds, rows}` |
| `GET /api/machines/{id}/history/latest` | `since` (RFC 3339) | Rows strictly newer than `since` |
| `GET /api/machines/{id}/health` | thresholds | `{health_percent, status_label, severity, commentary, peak_vibration}` |
| `GET /api/machines/{id}/anomalies` | `seconds`, `sigma`, `lookback`, `max_points` | Rows with `peak_vibration`, `moving_avg`, `upper_bound`, `lower_bound` |
| `GET /api/machines/{id}/root-cause-history` | `limit` (≤ 500), `seconds` (0 = all), thresholds | `[{time, fault_type, urgency}]` |
| `POST /api/connectivity/test` | JSON `{host, port, unit_id}` | `{reachable, responded, detail, …}` |

"Thresholds" = `vib_warn`, `vib_critical`, `vib_scale`, `temp_warn`,
`temp_critical` (defaults 1.8, 4.5, 4.5, 50, 60).

`limits` on `/api/machines` lets each machine be scored against its own limits:
`id:vib_warn:vib_critical:vib_scale:temp_warn:temp_critical`, comma separated.

Try them in a browser at http://localhost:8000/docs (FastAPI's built-in page)
when auth is off.

### 9.3 How a query is built

Every route follows the same three steps:

```python
flux = _stream("-300s", machine_id, ["vibration_x"])   # 1. build
rows = run_flux(flux + _PIVOT)                          # 2. run
# 3. run_flux() already called _row() on every result:
#    renamed motor_VBR_VX → vibration_x, divided by 100, time → "...Z"
```

`_stream()` produces:

```flux
from(bucket: "PREDICTIVE_MAINTAINANCE_MODULE")
  |> range(start: -300s)
  |> filter(fn: (r) => r._measurement == "MOTOR")
  |> filter(fn: (r) => r._field == "motor_VBR_VX")
  |> filter(fn: (r) => r["device_id"] == "MOTOR001")
```

Things that are not obvious about Flux:

- **`range()` is mandatory.** There is no "give me the latest, however old".
  Routes use `MAX_LOOKBACK` (7 days) for that.
- **Results come back long**: one row per field per timestamp. Every query
  ends in `pivot()` to rebuild one row per timestamp with a column per field.
- **No `STDDEV` over a window, no `GREATEST`, no `CASE`.** So the anomaly band,
  the peak of three axes and fault classification are done in Python.
- **Some filters disable the index and become full scans.** `contains()` and
  `or tag == ""` both do. They made routes 400× slower and caused timeouts.
  Always build field filters with `_field_match()` (a chain of `==`).

**Long time windows are bucketed** so the browser never gets more than
`max_points` rows: bucket size = `ceil(seconds / max_points)`, minimum 2 s.
Vibration, displacement and fault codes use **MAX** per bucket (a 1-second
spike survives at a week's zoom; a fault code is never averaged into a
different code); everything else uses **MEAN**. Empty buckets are left out, so
a gap stays a gap.

### 9.4 Health scoring — `compute_health()`

Evaluated top to bottom; the first match wins:

| Condition | Label | Severity | Score |
|---|---|---|---|
| Temperature > critical | CRITICAL: OVERHEAT | critical | none |
| Status = 0 | E-STOP ENGAGED | warning | none |
| Status = 1 and temperature > warning | WATCH: Elevated Temperature | watch | none |
| Status = 1 | MOTOR STOPPED | idle | none |
| No vibration reading at all | NO VIBRATION DATA | unknown | none |
| Z axis > warning | ALARM: Axial Misalignment | warning* | yes |
| X or Y > warning | WARNING: Radial Unbalance/Looseness | warning* | yes |
| Temperature > warning | WATCH: Elevated Temperature | watch | yes |
| otherwise | SYSTEM OPTIMAL | ok | yes |

\* becomes `critical` if the peak exceeds the critical limit.

Score = `100 − peak ÷ vib_scale × 100`, clamped 0–100.

A stopped motor gets **no score on purpose**: it isn't vibrating, so "100%"
would describe bearings nobody measured. A running motor with no vibration
reading says NO VIBRATION DATA rather than a perfect score — otherwise a dead
sensor would look like the healthiest machine on site.

### 9.5 Anomaly detection

For each sample: peak = max(X, Y, Z). Over the last `lookback` samples, mean
and standard deviation. Band = mean ± `sigma` × deviation. A sample is an
**anomaly** if it is above the upper band **and** above `anomaly_floor`.

This is relative to the machine's own recent behaviour, so it is much more
sensitive than the alarm limits. On an idle motor at 0.00 mm/s, a twitch to
0.03 mm/s is "many sigma out" — the floor (default 0.5 mm/s) is what stops
that being counted.

The Overview card counts over the last hour (1-second peaks, the fallback
sigma); the Diagnostics page counts over the selected range with the machine's
own tuning. The two numbers can differ.

### 9.6 Root cause history

Readings where any axis exceeded the vibration warning or the temperature
exceeded its warning, newest first, each classified:

| First matching rule | Fault | Urgency |
|---|---|---|
| temp > critical | Thermal Overload | Immediate shutdown |
| Z > critical | Axial Misalignment | CRITICAL (Zone D) |
| Z > warning | Axial Misalignment | Urgent (Zone C) |
| Y > warning | Vertical Looseness | Caution — inspect mounting |
| X > warning | Horizontal Unbalance | Maintenance — balancing |
| temp > warning | Elevated Temperature | Monitor |

This uses **absolute alarm limits**. That is why an anomaly can appear on the
chart with no root-cause entry: a statistical outlier at 0.4 mm/s is not a
fault when the warning limit is 1.8 mm/s.

### 9.7 Online, idle, offline

- **Online** = the newest row is younger than `ONLINE_WINDOW_SECONDS` (30 s).
- **run_state**: `OFFLINE` (nothing arriving), `IDLE` (arriving, motor
  stopped), `RUNNING`, `E-STOP`, `UNKNOWN`.

OFFLINE is about *data*, not the network. A machine can be pingable and
OFFLINE (MQTT broken), or unpingable and online (old data inside 30 s).

---

## 10. The frontend (React)

React 19, Vite 8, Tailwind CSS 4, Recharts 3. All in `pdm-frontend/src/`.

### 10.1 App shell — `App.jsx`

```
<AuthProvider>
  <Gate>                         login screen / password reset / dashboard
    <SettingsProvider>           operator's display preferences
      <IdleGuard>                inactivity sign-out + warning modal
        <MachinesProvider>       machine list + live fleet status
          <Dashboard>            sidebar + the current page
```

**Routing** is the URL hash: `#/diagnostics/MOTOR001`. No router library —
see `useHashRoute()`. Reloading lands on the same page and machine; links can
be pasted.

### 10.2 State — `contexts/`

Each context is split into two files (a React Fast Refresh requirement the
linter enforces):

| Store (`*Store.js`) | Provider (`*Context.jsx`) | Holds |
|---|---|---|
| `authStore.js` | `AuthContext.jsx` | Session, sign in/out, password reset, whether sign-up is allowed |
| `settingsStore.js` | `SettingsContext.jsx` | Display preferences; saves to Supabase `user_settings` and `localStorage` |
| `machinesStore.js` | `MachinesContext.jsx` | Machine definitions (Supabase), live fleet status (API, every 5 s), per-machine config |

`MachinesContext` gives two views of a machine's config: `storedConfigFor(id)`
(exactly what is in the database — used by the settings form) and
`configFor(id)` (with the standard's limits folded in — used for API calls).

### 10.3 Pages — `pages/`

| File | Page |
|---|---|
| `ProfilePage.jsx` | Account details, change password, sign out (only with Supabase) |
| `OverviewPage.jsx` | One card per machine |
| `DiagnosticsPage.jsx` | Everything about one machine (below) |
| `MachinesPage.jsx` | Add / edit / remove machines; test the PLC connection |
| `SettingsPage.jsx` | Machine configuration and display preferences |
| `LoginPage.jsx` | Sign in, optional sign up, forgotten password |
| `UpdatePasswordPage.jsx` | Shown after clicking a password-reset link |

**DiagnosticsPage** polls (at the refresh rate, default 1 s):

| What | Endpoint | How often |
|---|---|---|
| Gauges | `/latest` | every refresh |
| Charts | `/history` | once, then live-tail via `/history/latest` for windows ≤ 15 min; full refetch every ≥ 5 s for longer windows |
| Health card | `/health` | every ≥ 2 s |
| Anomaly chart | `/anomalies` | every ≥ 2 s |
| Root cause table | `/root-cause-history` | every ≥ 5 s |

Each request has its own error slot, cleared when it next succeeds, so a
one-off network blip doesn't leave a red banner up forever.

### 10.4 Components — `components/`

| File | What |
|---|---|
| `Sidebar.jsx` | Navigation; becomes a top bar on narrow screens |
| `MachineCard.jsx` | Overview card |
| `GaugeCard.jsx` | Half-circle gauge; shows "—" for a missing value, never 0 |
| `HealthScoreCard.jsx` | Health label, score, explanation |
| `RootCauseHistoryTable.jsx` | Fault list, or a note saying what was checked |
| `AnomalyChart.jsx` | Peak vibration, band, anomalies, alarm lines |
| `TimeSeriesChart.jsx` | Every line chart; Alarm/Fit toggle; optional dual axis and footnote |
| `FaultCodeTimeline.jsx` | Fault codes as one coloured lane per axis |
| `TimeRangePicker.jsx` | Range and refresh dropdowns |
| `SaveBar.jsx` | The sticky Save/Discard bar on Settings |
| `IdleWarning.jsx` | "Session about to end" modal |
| `inputs/Slider.jsx`, `inputs/SegmentedControl.jsx` | Settings inputs |

### 10.5 Libraries — `lib/` and `utils/`

| File | What |
|---|---|
| `lib/api.js` | `apiFetch` / `apiPost` — adds the login token to every API call |
| `lib/supabase.js` | Supabase client; reads whether sign-up is enabled |
| `lib/defaults.js` | Every default (time ranges, refresh rates, machine config), and the helpers that merge, store and compare configs |
| `lib/standards.js` | ISO vibration zone tables and `resolveLimits()` |
| `lib/status.js` | **The** vocabulary for run state and severity, with colours |
| `utils/time.js` | Timestamp parsing, axis/tooltip formatting, tick generation |
| `utils/chartConfig.js` | Shared chart styles, min/max decimation, tooltip number formatting |
| `panels.js` | Which fields each chart plots |

### 10.6 Vibration standards — `lib/standards.js`

A machine stores *which* standard and class it uses, never the numbers. The
limits are read from the table, so they can't drift from the class:

| Standard | Class | A/B | **Warning** (B/C) | **Critical** (C/D) |
|---|---|---|---|---|
| ISO 10816-1 | Class I — small (≤ 15 kW) | 0.71 | 1.8 | 4.5 |
| ISO 10816-1 | Class II — medium | 1.12 | 2.8 | 7.1 |
| ISO 10816-1 | Class III — large, rigid | 1.8 | 4.5 | 11.2 |
| ISO 10816-1 | Class IV — large, flexible | 2.8 | 7.1 | 18.0 |
| ISO 20816-3 / 10816-3 | Group 2, rigid | 1.4 | 2.8 | 4.5 |
| ISO 20816-3 / 10816-3 | Group 2, flexible | 2.3 | 4.5 | 7.1 |
| ISO 20816-3 / 10816-3 | Group 1, rigid | 2.3 | 4.5 | 7.1 |
| ISO 20816-3 / 10816-3 | Group 1, flexible | 3.5 | 7.1 | 11.0 |
| Custom | — | — | typed in | typed in |

All values mm/s RMS. The default is ISO 10816-1 Class I (1.8 / 4.5).

### 10.7 Look and feel

Colours are theme tokens in `index.css` (`bg-deep`, `bg-panel`,
`accent-cyan`, `status-green/amber/red`, …). Use those rather than raw
Tailwind colours, so everything stays consistent. Fonts are loaded from Google
Fonts; on a network with no internet access they fall back to system fonts,
which is harmless.

---

## 11. Supabase: logins, machines, settings

Defined in `supabase/schema.sql`.

| Table | Key | Holds | Who can read/write |
|---|---|---|---|
| `user_settings` | `user_id` | One operator's display preferences (`settings` jsonb) | Only that user |
| `machines` | `id` (= device id, e.g. `MOTOR001`) | name, location, notes, PLC address (`source`), per-machine config (`thresholds`) | Any signed-in user |

The seed creates two machines if they don't already exist: **`MOTOR001`** (the
real motor) and **`demo01`** (see §16 — it shows OFFLINE on the dashboard).

**Adding an operator:** Supabase dashboard → Authentication → Users → Add
user. Or allow self-registration (Authentication → Sign In / Providers →
*Allow new users to sign up*) — the login screen then shows *Create account*
automatically on the next page load, with no rebuild.

**Gotcha:** Postgres `jsonb` reorders keys, so a saved config comes back in a
different key order. Always compare configs with `stableStringify()` from
`lib/defaults.js`, never `JSON.stringify`, or the Save bar never clears.

---

## 12. The local services (Grafana and friends)

These run in Docker but are **not** used by the dashboard.

- **Local InfluxDB 3 Core** (`:8181`) — Node-RED's local copy, in real units,
  queried with SQL. Browse it with InfluxDB Explorer at http://localhost:8888.
- **Grafana** (`:3000`, admin / admin) — the original prototype dashboard,
  loaded from `grafana/dashboards/motor01-prototype.json` on every start. Its
  panels are SQL against the local store. Changes made in the Grafana UI are
  lost on restart unless exported back to that file.
- **Postgres** (`:5432`, admin / admin, database `motor_db`) — the
  `machine_activity_logs` table, written on each status change, read by
  Grafana's Motor Status panel. `postgres/init/` only runs when the volume is
  first created.
- **Mosquitto** (`:1883`) — a local MQTT broker. Nothing uses it: the flow
  publishes to Novaflow's broker. It is kept so the stack starts as designed.

---

## 13. How to… (common tasks)

### Add a second motor

1. On its PLC flow, give it a distinct `DEVICE_ID` in *Build MQTT Payload*
   (e.g. `MOTOR002`). Confirm with Novaflow that their ingest accepts it.
2. Dashboard → **Machines → Add machine**, Machine ID **exactly** `MOTOR002`.
3. Dashboard → **Settings → Machine configuration**, pick its standard/class.

If the ID doesn't match the `device_id` in the bucket exactly (case matters),
the machine stays OFFLINE.

### Change a machine's alarm limits

Settings → Machine configuration → choose the machine → pick the standard and
class (or *Custom*) → **Save changes**. Applies to everyone immediately.

### Add a chart

1. Add a series list to `panels.js`:
   ```js
   export const CHIP_TEMP = [
     { name: 'Sensor chip', field: 'sensor_chip_temp', color: '#94A3B8' },
   ]
   ```
2. Import it in `DiagnosticsPage.jsx` and add
   `<TimeSeriesChart title="Sensor Chip Temperature (°C)" data={history} series={CHIP_TEMP} maxPoints={settings.maxPoints} {...win} />`.
3. `npx eslint src && npm run build`.

The field must exist in API rows — i.e. be in `GUIDELINE_FIELDS`. Don't write
"µm" in a title: titles are uppercased in CSS, which turns µ into Μ ("MM").
Write "microns".

### Show the commanded speed (`speed_command_hz`)

It is read from the PLC but not published. You need all three:

1. Add a field to the MQTT payload in *Build MQTT Payload*, with a factor in
   `SCALE` (agree the field name with Novaflow).
2. Add a matching entry to `GUIDELINE_FIELDS` in `main.py`.
3. Add the series back to `ACTUAL_FREQ` in `panels.js`.

### Change a scale factor

Change the `SCALE` entry in the flow **and** the divisor in `GUIDELINE_FIELDS`,
together. Old data in the cloud was stored with the old factor and will read
wrong afterwards — usually you should leave factors alone.

### Rotate the InfluxDB token

1. InfluxDB UI → Load Data → API Tokens → create a new read-only token for the
   bucket.
2. Put it in `.env` as `INFLUX_TOKEN`, `docker compose up -d api`.
3. Check `/api/health` and the dashboard, then **delete the old token** in the
   InfluxDB UI.

### Switch to HTTPS (once the server supports it)

1. `INFLUX_URL=https://sm365db.novaplus.my` in `.env`.
2. Remove `INFLUX_ALLOW_INSECURE`.
3. `docker compose up -d api` and check `/api/health` → `telemetry_blocked`
   is `null`.
4. Rotate the token (it has been sent unencrypted until now).

### Test whether the PLC is reachable

Machines → Configure → **Test connection**. Or:

```bash
curl -X POST http://localhost:8000/api/connectivity/test \
     -H "Content-Type: application/json" \
     -d '{"host":"192.168.0.30","port":502,"unit_id":1}'
```

---

## 14. Troubleshooting

Start with `curl http://localhost:8000/api/health`, then
`docker compose logs --tail 50 api`.

| Symptom | Likely cause | Fix |
|---|---|---|
| Every machine OFFLINE, nothing on the dashboard | No data reaching the cloud: Node-RED flow not deployed, MQTT broker unreachable, or PLC not answering | Check Node-RED (:1880) debug log; check the newest row in the cloud bucket (InfluxDB UI → Data Explorer) |
| `/api/health` shows `telemetry_blocked` | `INFLUX_URL` is `http://` to a remote host | Set `INFLUX_ALLOW_INSECURE=true` (temporary) or use HTTPS |
| Routes return **502** "Read timed out" | A slow Flux query (> 30 s). Often a filter that disabled the index | Look for `contains(` or `or … == ""` in new Flux code; use `_field_match()` |
| Routes return **502** "Unauthorized" | Token wrong, expired or deleted | New read-only token in `.env` |
| A machine OFFLINE but others online | Machine ID ≠ `device_id` in the bucket | Make them identical (case-sensitive) |
| Values 10× or 100× off | `SCALE` (flow) and `GUIDELINE_FIELDS` (API) disagree | Make them match |
| A chart is empty | That field is not in the payload, or the motor is stopped (many readings are genuinely 0) | Check the field exists in the bucket |
| Health says MOTOR STOPPED with no % | Working as designed — a stopped motor is not scored | — |
| Gauges show "—" | That reading is missing from the newest row | Check the PLC register / flow |
| Login screen never appears | `VITE_SUPABASE_*` blank, or frontend not rebuilt after setting them | Set them in `.env.local`, `npm run build` |
| Can't log in, API returns 401 | API and frontend point at different Supabase projects | Same URL + key in `.env` and `.env.local` |
| Settings won't save | Supabase not configured, or `schema.sql` not run | The amber banner on Settings says which |
| Save bar never clears after saving | Comparing configs with `JSON.stringify` | Use `stableStringify()` |
| Browser tab crashes after a while | Running `npm run dev` | Use `npm run build` + `npm run preview` |
| `mosquitto` container keeps restarting | `mosquitto/config/mosquitto.conf` missing | Create it (§5.4) |
| Node-RED log: repeated `401 Unauthorized` | Local InfluxDB token missing in the *Stream to InfluxDB* node | Type it in the editor and Deploy |
| Grafana panels empty | Local store not being written, or local Parquet file limit hit | Check Node-RED; see CLAUDE.md "Parquet file cap" |
| API change has no effect | Syntax error stopped the auto-reload | `docker compose logs api` |
| Phone screenshot from headless Chrome looks clipped | Headless Chrome won't render below ~500 px | Test inside a fixed-width `<iframe>` |

---

## 15. Rules that must not be broken

These come from real problems. Each one has caused a bug before.

1. **Never fabricate data.** No zero-filling gaps, no "0" for a missing
   reading, no health score from configuration alone. A fake zero reads as
   "measured and fine" and hides a failed sensor. Gaps render as gaps
   (`connectNulls={false}`, `createEmpty: false`).
2. **Never write to the cloud InfluxDB**, and never point the Node-RED InfluxDB
   node at it. Never write synthetic data under a real machine's ID.
3. **`SCALE` (flow) and `GUIDELINE_FIELDS` (API) always change together.**
4. **The frontend never talks to a database directly** for telemetry — only
   through FastAPI.
5. **The API is stateless.** Limits and tuning arrive as query parameters.
   Don't add server-side config.
6. **Alarm limits belong to the machine**, display preferences to the
   operator. Don't mix them.
7. **Charts with alarm lines are scaled to the alarm**, not the data. "Fit" is
   opt-in and marked "zoomed".
8. **Fault codes are codes**: bucket with MAX, never average, never draw as a
   line.
9. **Never use `contains()`** in Flux filters; never add `or tag == ""` on the
   cloud bucket.
10. **Never `npm run dev`.**
11. **Never commit `.env`, `.env.local`, or any token.** Never use the
    Supabase `service_role` key.
12. **Don't edit the working *Map, Scale & Process Buffer* function** to bolt
    on new outputs. Add a new wire and a new function, as the MQTT branch did.
13. **Don't "fix" the acceleration zeros.** It's a sensor firmware limitation.

---

## 16. Known issues and open items

| Item | Detail | What to do |
|---|---|---|
| **No HTTPS to the cloud InfluxDB** | The server has a valid certificate on port 443, but Apache's proxy to InfluxDB is broken (`/api/v2/*` returns 503). Only plain HTTP on 8086 works, so the token travels unencrypted. | Ask whoever runs `sm365db.novaplus.my` to set `ProxyPass / http://127.0.0.1:8086/` in the 443 vhost, then follow "Switch to HTTPS" (§13) and rotate the token. |
| **Token rotation pending** | The current token has been used over plain HTTP. | Rotate before any deployment beyond the trusted network. |
| **Commanded speed not shown** | `speed_command_hz` isn't in the MQTT payload. | See §13. |
| **`demo01` shows OFFLINE** | `tools/demo_machine.py` writes to the local store, which the dashboard doesn't read. It appears in Grafana only. | Either remove `demo01` from the Machines page, or give the API a second (local) data source. Don't write synthetic data into the production bucket. |
| **Acceleration always 0** | WTVB01-485 firmware doesn't expose raw acceleration. Not charted. | None — hardware. |
| **Flow zero-fills at the source** | The `safe()` helper in *Map, Scale & Process Buffer* turns any unreadable value into `0` before it reaches InfluxDB or MQTT, so "missing" can't be told apart from "zero" in those fields. | Would need the working function changed — do it carefully, test in a copy of the flow first. |
| **Stale comment in the flow** | A comment in the Map function says offsets 6–8 are "not used here"; the code does use them for velocity. | Harmless; fix next time the flow is edited. |
| **Flow writes ~3× per second** | The join re-emits on most Modbus replies, not once per full cycle. Causes duplicate rows locally and extra MQTT traffic. | Fix the join's settings in the editor. |
| **X-axis fault code 20, constantly** | The sensor reports `fault_x = 20` all the time, even idle. | Check what code 20 means in the WTVB01-485 manual. |
| **Overview vs Diagnostics anomaly counts differ** | Different windows and tuning (§9.5). | Expected. |
| **"All history" fault table takes ~5 s** | It scans 7 days. | Acceptable; reduce `INFLUX_MAX_LOOKBACK` if needed. |
| **Supabase permissions are wide** | Any signed-in user can read and edit every machine. | Tighten the RLS policies in `schema.sql` before giving access to people outside the team. |
| **Development passwords** | Postgres `admin/admin`, Grafana `admin/admin`, Node-RED credentials unencrypted (`credentialSecret: false`). | Change before any wider deployment. |
| **API runs with `--reload`** | Convenient for development; not for production. | Remove `--reload` from `docker-compose.yml` when deploying. |
| **PLC programming (AutoShop)** | The PLC is an **Inovance** unit (MAC prefix 70:CA:4D). It answers ping, Modbus on 502, and AutoShop's ports 12939/12940. AutoShop had connected and then dropped the session. | Try stopping Node-RED (`docker compose stop node-red`) while using AutoShop, and check the AutoShop project's PLC model matches the hardware. Start Node-RED again afterwards. |

---

## 17. Security

- **Tokens and keys** live only in `.env` and `pdm-frontend/.env.local`, both
  gitignored. Check before every push (§6).
- **InfluxDB token**: read-only, scoped to the one bucket. Never an admin
  token. Currently sent over plain HTTP — see §16.
- **The API refuses cleartext by default.** `INFLUX_ALLOW_INSECURE=true`
  overrides that. Certificate checking stays on and must stay on.
- **Supabase anon key** is public by design — it is in the browser bundle.
  Security comes from the Row Level Security policies in `schema.sql`.
- **Never** request, store or use the Supabase `service_role` key.
- **Sign-up** is controlled in the Supabase dashboard, not in code; the login
  screen follows it and fails closed if it can't tell.
- **The sign-up form never reveals whether an email already has an account.**
  Keep that behaviour.
- **Inactivity sign-out** (default 30 minutes) protects an unattended
  terminal. The dashboard's own polling does not count as activity, on
  purpose.

---

## 18. Glossary

| Term | Meaning |
|---|---|
| **Bucket** | An InfluxDB 2.x database. Ours: `PREDICTIVE_MAINTAINANCE_MODULE`. |
| **Measurement** | Like a table inside a bucket. Ours: `MOTOR`. |
| **Tag** | An indexed label on a row, e.g. `device_id`. Filter on these. |
| **Field** | A measured value, e.g. `motor_VBR_VX`. |
| **Flux** | InfluxDB 2.x's query language (the cloud store). |
| **Pivot** | Turning one-row-per-field into one-row-per-timestamp. |
| **Pushdown** | InfluxDB running a filter inside its storage index. Fast. Some filters prevent it. |
| **Guideline schema** | The Novaflow MQTT naming and integer scaling (`motor_VBR_VX`, ×100). |
| **Native schema** | Real-unit field names (`vibration_x`), as in the local store. |
| **Modbus TCP** | The protocol Node-RED uses to read PLC registers (port 502). |
| **D-register** | A PLC data register, e.g. D406. |
| **MQTT** | Lightweight publish/subscribe messaging; how data reaches Novaflow. |
| **RMS velocity** | The vibration measure ISO standards use, in mm/s. |
| **Zone A–D** | ISO severity bands: A new, B fine long-term, C unsatisfactory, D damaging. |
| **Sigma (σ)** | Standard deviation; the anomaly band is mean ± sigma × σ. |
| **RLS** | Row Level Security — Postgres rules deciding who sees which rows in Supabase. |
| **Anon key** | Supabase's public client key; safe to expose. |
| **rbe node** | Node-RED "report by exception": passes a message only when it changes. |
| **Live tail** | Fetching only new rows since the last one, instead of the whole window. |
| **Decimation** | Thinning chart points (keeping each bucket's min and max) so spikes survive. |
