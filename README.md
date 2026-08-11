# Predictive Maintenance Module

A standalone condition-monitoring and predictive-maintenance module for industrial motors. It acquires vibration and drive telemetry from a PLC, stores it as time-series data, exposes it through a REST API, and renders it in a custom web dashboard.

This repository contains the two application layers that are portable to a cloud environment — the **FastAPI backend** and the **React frontend** — plus the Docker Compose definition and the Node-RED acquisition flow for the supporting data pipeline.

---

## 1. System Overview

### Physical layer

An **Inovance Easy320 PLC** communicates with a **WTVB01-485 vibration sensor** and a **VFD (inverter drive)** over Modbus RTU, and exposes the collected values in its D-register memory area.

### Acquisition layer

**Node-RED** polls the PLC over **Modbus TCP** once per second, across four parallel register-block reads (motor status, power/temperature, drive controls & metrics, and extended vibration), joins them into a single reading cycle, scales the raw integers into engineering units, and writes the result into InfluxDB and — on status changes only — PostgreSQL. Node-RED is used *only* for acquisition and processing of raw registers; it performs no analytics and serves no user-facing content. The full flow is documented in §5 and exported at `node-red-flows/flows.json`.

### Storage layer

- **InfluxDB 3 Core** — all time-series sensor data, written once per second.
  - Bucket: `machine_telemetry`
  - Measurement: `motor_metrics`

### Application layer

- **FastAPI** queries InfluxDB, performs all processing (health scoring, anomaly detection, fault classification, downsampling), and serves clean JSON over HTTP.
- **React (Vite)** consumes only the FastAPI endpoints and renders the dashboard.

> **Important architectural point for whoever migrates this:** the frontend never talks to InfluxDB directly. All database access is server-side, inside FastAPI. This matters because it means the database does not need to be publicly reachable — only the API does.

### Data flow

```
Sensor / VFD
    │  Modbus RTU
    ▼
Easy320 PLC
    │  Modbus TCP, polled 1 Hz (4 parallel register blocks)
    ▼
Node-RED  (join → scale → route)
    │ 
    │ 1 Hz, all fields
    ▼  
InfluxDB 3 Core
    │
    │  SQL query
    ▼
FastAPI  (pdm-backend/main.py)
    │  JSON over HTTP
    ▼
React + Vite  (pdm-frontend)
```

---

## 2. Repository Structure

```
smartpulse365/
├── docker-compose.yml      # All pipeline services
├── .env.example             # Required environment variables (no secrets)
├── .gitignore
├── node-red-flows/
│   └── flows.json          # Exported acquisition flow — see §5
├── pdm-backend/             # FastAPI application
│   ├── main.py              # All API routes and InfluxDB queries
│   ├── requirements.txt
│   └── Dockerfile
└── pdm-frontend/            # React (Vite) application
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx         # React entry point
        ├── App.jsx          # Layout, routing, centralised data fetching
        ├── panels.js        # Chart configuration (data-driven)
        ├── App.css
        ├── index.css
        ├── components/
        │   ├── Sidebar.jsx
        │   ├── StatCard.jsx
        │   ├── GaugeCard.jsx
        │   ├── TimeSeriesChart.jsx
        │   ├── AnomalyChart.jsx
        │   ├── HealthScoreCard.jsx
        │   └── RootCauseHistoryTable.jsx
        ├── pages/
        │   ├── OverviewPage.jsx
        │   └── DiagnosticsPage.jsx
        └── utils/
            ├── chartConfig.js
            └── time.js
```

Runtime data directories (`influxdb_data/`, `postgres_data/`, `grafana_data/`, `node_red_data/`, `ollama_data/`, `langflow_data/`, `mosquitto/`) are **deliberately excluded** from version control. They are Docker bind-mount volumes containing binary database files and are recreated on first startup. `node-red-flows/flows.json` is different — it's the portable *definition* of the flow, not runtime state, so it is committed even though the `node_red_data/` folder it normally lives inside is not.

---

## 3. Backend — `pdm-backend/`

### How it works

`main.py` is a single FastAPI application. Each route:

1. Builds a SQL query against InfluxDB 3 Core.
2. Executes it via the InfluxDB HTTP query API.
3. Normalises timestamps and field names.
4. Returns a JSON array or object.

All computation lives here rather than in the browser, so the frontend stays a thin rendering layer.

### API endpoints

All routes are namespaced per machine, so adding a second machine is a routing change rather than a rewrite.

| Endpoint | Purpose |
|---|---|
| `GET /api/machines/motor01/latest` | Most recent 1-second snapshot of all fields. Drives the Overview stat cards. |
| `GET /api/machines/motor01/history` | Full window of time-series data for chart initialisation. |
| `GET /api/machines/motor01/history/latest` | Delta fetch — returns only rows newer than the last received timestamp, with deduplication and a 5-minute sliding window. Keeps the polling payload small. |
| `GET /api/machines/motor01/health` | Composite health score derived from ISO 10816 vibration severity zones. |
| `GET /api/machines/motor01/anomalies` | Statistical anomaly flags using a rolling mean ±3σ, computed with SQL window functions. |
| `GET /api/machines/motor01/root-cause-history` | Threshold-based fault classification history (imbalance, misalignment, looseness, bearing indicators). |

### Stored fields

`vibration_x/y/z`, `disp_x/y/z`, `vib_freq_x/y/z`, `accel_x/y/z`, `sensor_chip_temp`, `rpm`, `voltage`, `frequency`, `power`, `current`, `torque`, `temperature`, `status_code`, `speed_command_hz`

`sensor_chip_temp` is the vibration sensor's own onboard temperature, distinct from `temperature` (the motor body/winding temperature read separately from the PLC).

### Query notes for maintainers

- **InfluxDB 3 Core uses SQL, not Flux.** Any Flux examples found online do not apply. Timestamp comparisons require explicit `CAST(... AS TIMESTAMP)`.
- Do not rely on the `asset_id` tag — it is not reliably written by the current Node-RED flow.
- Time-series queries must filter by time range and `ORDER BY time ASC`. Using `ORDER BY time DESC LIMIT n` without a time filter silently returns only the newest *n* rows regardless of the requested window.
- Smoothing (e.g. 5-point moving averages) is applied at query time for display only. Raw values are never overwritten in storage.

---

## 4. Frontend — `pdm-frontend/`

Built with **React 19 + Vite**, charts rendered with **Recharts**.

### Composition

- **`main.jsx`** — mounts the app.
- **`App.jsx`** — owns the sidebar layout, page switching, and the shared history poll. A single fetch loop supplies every chart, rather than each chart polling independently.
- **`panels.js`** — declarative chart configuration. Each entry defines a chart's title, source fields, colours, and units. Adding a new chart means adding an object here, not writing a new component.
- **`components/`** — presentational units:
  - `StatCard` / `GaugeCard` — single-value readouts.
  - `TimeSeriesChart` — one generic, config-driven chart component used for all trend plots.
  - `AnomalyChart`, `HealthScoreCard`, `RootCauseHistoryTable` — analytics views bound to their respective API endpoints.
- **`pages/`** — composition of components into screens:
  - `OverviewPage` — at-a-glance machine state via stat cards.
  - `DiagnosticsPage` — trend charts, health score, anomaly detection, and fault history. This page owns its own fetching so polling stops when the user navigates away.
- **`utils/`** — `time.js` (timestamp formatting) and `chartConfig.js` (shared axis/tooltip defaults).

### Performance constraints (do not regress these)

The dashboard renders thousands of points at 1 Hz. The following were required to keep it stable:

- **Run production builds, not the dev server.** React 19's dev-mode `performance.measure()` instrumentation accumulates memory outside the V8 heap and will eventually crash the tab.
- A **single reused `Intl.DateTimeFormat` instance** in `time.js`. Constructing one inside a `.map()` allocates thousands of objects per render.
- Timestamps are **normalised once at ingest**, not per render.
- Chart configuration objects are **hoisted to module scope**.
- `memo()` and `useMemo()` on all chart components; `isAnimationActive={false}` on all Recharts `Line` elements.
- **Min/max decimation** before rendering — reduces point count while preserving spike amplitudes.

---

## 5. Node-RED Acquisition Flow — `node-red-flows/flows.json`

This is the flow Node-RED runs to poll the PLC and populate the databases. It's exported as JSON so it can be re-imported into any Node-RED instance (Menu → Import). It is **not** regenerated automatically from the running container — after editing the flow in the Node-RED editor, it must be re-exported and this file updated manually.

### Structure

Four separate Modbus reads run in parallel, each once per second, against the same TCP-connected PLC:

| Node | Register range | Contents |
|---|---|---|
| `D210: Motor Status` | `D210`, 1 register | Motor state code (E-STOP / STOPPED / RUNNING) |
| `D222-D230: Power & Temp` | `D222`–`D230`, 9 registers | Voltage, current, power, torque, motor temperature |
| `D4110-D4212: Controls & Metrics` | `D4110`–`D4212`, 104 registers | Drive frequency and RPM (32-bit floats), speed command |
| `D400-D418: Extended Vibration` | `D400`–`D418`, 19 registers | Vibration velocity, acceleration, displacement, dominant frequency, sensor chip temperature |

A `join` node collects all four topics into a single message before further processing (`count: 4`), so one reading cycle is only processed once all four blocks have arrived.

### Processing (`Map, Scale & Process Buffer` function node)

This is where raw register integers become engineering values:

- **Signed 16-bit reinterpretation.** Modbus holding registers are unsigned (0–65535). Values that can genuinely go negative — acceleration and the vibration sensor's own chip temperature — are converted with a `toSigned16()` helper, otherwise a negative reading would appear as a number near 65535.
- **32-bit float parsing.** Frequency and RPM are transmitted across two consecutive registers as an IEEE-754 float with word order swapped; `parse32BitFloatSwapped()` reconstructs the value.
- **Safety override.** `speed_command_hz` is forced to 0 whenever the motor status is E-STOP or STOPPED, regardless of what the drive's raw command register reports.
- **Known-zero fields kept, not dropped.** `accel_x/y/z` are computed and included in the payload even though they currently read as hard zero on this hardware (see §9). This keeps the gap visible in the data rather than silently absent.

## 6. Docker Services

| Service | Image | Port | Role |
|---|---|---|---|
| `api` | built from `./pdm-backend` | 8000 | FastAPI application |
| `influxdb` | `influxdb:3-core` | 8181 | Time-series storage |
| `postgres` | `postgres:16` | 5432 | Status and event logs |
| `node-red` | `nodered/node-red` | 1880 | Modbus TCP acquisition |
| `mosquitto` | `eclipse-mosquitto` | 1883 / 9001 | MQTT broker |
| `grafana` | `grafana/grafana` | 3000 | Legacy dashboard (superseded, retained for reference) |

Grafana was the original visualisation layer and has been replaced by the React frontend. It remains in the stack only as a comparison reference and can be removed for a production deployment.

---

## 7. Running Locally

```bash
git clone https://github.com/kazubazoo/smartpulse365.git
cd smartpulse365

cp .env.example .env      # then fill in real values
docker compose up -d
```

Then open Node-RED at `localhost:1880`, import `node-red-flows/flows.json` (Menu → Import), re-enter credentials and confirm the PLC IP address, and deploy the flow.

Frontend:

```bash
cd pdm-frontend
npm install
npm run build
npm run preview
```

Use `npm run build && npm run preview` rather than `npm run dev` — see the performance notes above.

---

## 8. Notes for Cloud Migration

Points that need attention when moving this off a single workstation:

1. **Credentials are currently hardcoded in `docker-compose.yml`.** PostgreSQL (`admin`/`admin`), Grafana admin password, and the InfluxDB database name are literals. These must be moved into environment variables and rotated before any public deployment.

2. **`INFLUXDB3_AUTH_TOKEN` is the only variable currently externalised** via `.env`. 

3. **The API container currently runs with `--reload` and bind-mounts the source directory.** This is a development configuration. For production, remove `--reload`, remove the `./pdm-backend:/app` volume mount, and rely on the image contents.

4. **Bind mounts vs. named volumes.** All persistence currently uses host-relative bind mounts (`./postgres_data`, etc.). On a cloud host these should become named volumes or managed database services.

5. **Node-RED flow is included** (`node-red-flows/flows.json`) but ships without the PostgreSQL credentials or the PLC's local network address — both were stripped before committing and must be re-entered in the Node-RED editor after import (see §5).

6. **The Modbus connection is site-local.** Node-RED must retain network reachability to the PLC. If the application tier moves to the cloud, either Node-RED stays on-premises and pushes to a cloud InfluxDB endpoint, or a VPN/edge gateway is required. This is the main topology decision to resolve.

7. **CORS.** The FastAPI CORS configuration currently assumes a localhost origin and will need the deployed frontend domain added.

8. **Multi-machine support.** Routes are already namespaced (`/api/machines/{id}/...`) but the machine ID is currently fixed to `motor01` in the query layer. Parameterising this is the natural next extension.

9. **InfluxDB output config has mixed 2.x/3.x fields** (see §5) — confirm which is authoritative before relying on the pipeline in a new environment.

---

## 9. Known Hardware Limitation

The `accel_x/y/z` registers (`0x34`–`0x36`, mapped to `D400`–`D402`) return hard zeros. This was confirmed by controlled substitution testing and is **not** a pipeline fault: the WTVB01-485 firmware integrates acceleration internally to derive velocity but does not expose the raw acceleration values in its output registers on this unit. Any analytics depending on raw acceleration would require a different sensor.

This is corroborated directly in the Node-RED flow's own code comments (`node-red-flows/flows.json`, `Map, Scale & Process Buffer` function), which document the same substitution test and deliberately keep the fields as zero rather than removing them from the payload.
