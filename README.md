# Predictive Maintenance Module

A predictive-maintenance module for industrial motors. It acquires vibration and drive telemetry from a PLC, stores it as time-series data, exposes it through a REST API, and renders it in a custom web dashboard.

This repository contains the two application layers that are portable to a cloud environment — the **FastAPI backend** and the **React frontend** — plus the Docker Compose definition for the supporting data-pipeline services.

---

## 1. System Overview

### Physical layer

An **Inovance Easy320 PLC** communicates with a **WTVB01-485 vibration sensor** and a **VFD (inverter drive)** over Modbus RTU, and exposes the collected values in its D-register memory area (`D400`–`D418`, a single consolidated 19-register block).

### Acquisition layer

**Node-RED** polls the PLC over **Modbus TCP** once per second, scales the raw register values into engineering units, and writes them into InfluxDB. Node-RED is used *only* for acquisition and insertion — it performs no analytics and serves no user-facing content.

### Storage layer

- **InfluxDB 3 Core** — all time-series sensor data.
  - Database: `machine_telemetry`
  - Measurement: `motor_metrics`
- **PostgreSQL** — status codes and discrete event logs.

### Application layer

- **FastAPI** queries InfluxDB, performs all processing (health scoring, anomaly detection, fault classification, downsampling), and serves clean JSON over HTTP.
- **React (Vite)** consumes only the FastAPI endpoints and renders the dashboard.

> **Important architectural point for migrations:** the frontend never talks to InfluxDB directly. All database access is server-side, inside FastAPI. This matters because it means the database does not need to be publicly reachable — only the API does.

### Data flow

```
Sensor / VFD
    │  Modbus RTU
    ▼
Easy320 PLC  (D400–D418)
    │  Modbus TCP, polled 1 Hz
    ▼
Node-RED
    │  line-protocol write
    ▼
InfluxDB 3 Core  ──  PostgreSQL
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
├── .env.example            # Required environment variables (no secrets)
├── .gitignore
├── pdm-backend/            # FastAPI application
│   ├── main.py             # All API routes and InfluxDB queries
│   ├── requirements.txt
│   └── Dockerfile
└── pdm-frontend/           # React (Vite) application
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx        # React entry point
        ├── App.jsx         # Layout, routing, centralised data fetching
        ├── panels.js       # Chart configuration (data-driven)
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

Runtime data directories (`influxdb_data/`, `postgres_data/`, `grafana_data/`, `node_red_data/`, `ollama_data/`, `langflow_data/`, `mosquitto/`) are **deliberately excluded** from version control. They are Docker bind-mount volumes containing binary database files and are recreated on first startup.

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

`vibration_x/y/z`, `disp_x/y/z`, `vib_freq_x/y/z`, `accel_x/y/z`, `rpm`, `voltage`, `frequency`, `power`, `current`, `torque`, `temperature`, `status_code`, `speed_command_hz`

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

## 5. Docker Services

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

## 6. Running Locally

```bash
git clone https://github.com/kazubazoo/smartpulse365.git
cd smartpulse365

cp .env.example .env      # then fill in real values
docker compose up -d
```

Frontend:

```bash
cd pdm-frontend
npm install
npm run build
npm run preview
```

Use `npm run build && npm run preview` rather than `npm run dev` — see the performance notes above.

---

## 7. Known Hardware Limitation

The `accel_x/y/z` registers (`0x34`–`0x36`, mapped to `D400`–`D402`) return hard zeros. This was confirmed by controlled substitution testing and is **not** a pipeline fault: the WTVB01-485 firmware integrates acceleration internally to derive velocity but does not expose the raw acceleration values in its output registers on this unit. Any analytics depending on raw acceleration would require further data aquisition.
