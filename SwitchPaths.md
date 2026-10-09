# SwitchPaths.md — Switching Between Local and Cloud

**How an operator changes between the local path and the cloud path, and how to
run both at once.** Background: `Local.md` (local) and `PassOver.md` (cloud).

---

## 1. The idea in 30 seconds

Node-RED reads the PLC once, then can send the data to **two independent
places**:

```
                     ┌──▶ LOCAL  : InfluxDB 3 + Postgres ──▶ Grafana  (:3000)
 PLC ──▶ Node-RED ───┤
                     └──▶ CLOUD  : MQTT ──▶ Novaflow ──▶ cloud InfluxDB
                                                   ──▶ FastAPI ──▶ React dashboard (:4173)
```

So "switching" is just two choices:

1. **Which outputs does Node-RED send to?** (turn nodes on or off)
2. **Which screens do you run?** (Grafana, React dashboard, or both)

> **One hard limit:** the React dashboard can **only** read the cloud database.
> It cannot be pointed at the local one (different database type and query
> language). If the cloud isn't receiving data, the dashboard shows OFFLINE —
> no setting changes that. Grafana can **only** read the local database.

---

## 2. Which Node-RED nodes belong to which path

Open http://localhost:1880. Each path is a few nodes at the end of the flow.

| Path | Nodes to **enable** |
|---|---|
| **Local** | *Stream to InfluxDB* · *Filter Status Change* · *Format Postgres SQL* · *Commit Log to Postgres* |
| **Cloud** | *Build MQTT Payload (Guideline v1.0)* · *Publish to Novaflow Broker* |

Never touch the nodes before them (the four Modbus reads, *Aggregate Modbus
Registers*, *Map, Scale & Process Buffer*). Both paths need those.

**To enable/disable a node:** double-click it and flip its **Enabled / Disabled**
switch, then press **Deploy**. A disabled node shows greyed out.

> The flow file in this repo ships with the **Local nodes disabled and the
> Cloud nodes enabled**. Re-importing `flows.json` resets to that.

---

## 3. The four recipes

Pick one. Each is: Node-RED nodes → containers → screen.

### A. Cloud only (the operator dashboard)

The normal production setup.

1. Node-RED: **Cloud nodes enabled, Local nodes disabled.** Deploy.
2. Containers:
   ```bash
   docker compose up -d api
   docker compose up -d --no-deps node-red
   cd pdm-frontend && npm run build && npm run preview
   ```
3. Open http://localhost:4173.

`.env` needs `INFLUX_TOKEN` (and `INFLUX_ALLOW_INSECURE=true` until HTTPS).

### B. Local only (Grafana, no internet needed)

For a bench, an offline site, or when the cloud is down.

1. Node-RED: **Local nodes enabled, Cloud nodes disabled.** Deploy.
   (Disabling the Cloud nodes stops the failed-connection noise when offline.)
2. Containers:
   ```bash
   docker compose up -d influxdb influxdb-explorer postgres grafana node-red mosquitto
   ```
3. Open http://localhost:3000 (admin / admin).

`.env` needs `INFLUXDB3_AUTH_TOKEN`. The token must also be typed into the
*Stream to InfluxDB* node (see `Local.md` §5).

### C. Both at the same time

1. Node-RED: **all six nodes enabled.** Deploy.
2. Containers: start everything:
   ```bash
   docker compose up -d --build
   cd pdm-frontend && npm run build && npm run preview
   ```
3. Grafana at :3000 and the dashboard at :4173 show the **same motor** from
   two separate databases.

This is the default full setup and the safest: if the cloud is unreachable,
Grafana keeps working.

### D. Neither (stop collecting)

Stop Node-RED: `docker compose stop node-red`. Every machine becomes OFFLINE on
the dashboard within 30 seconds — correct, because nothing is arriving.

---

## 4. Switching in practice

**Local → Cloud**

1. Node-RED: enable the 2 Cloud nodes (disable the 4 Local nodes if you want
   cloud only). Deploy.
2. Check the debug panel: *MQTT payload (inspect)* should show messages.
3. Start the API and frontend (recipe A).
4. Wait ~30 s. The machine should turn from OFFLINE to RUNNING or IDLE.

**Cloud → Local**

1. Node-RED: enable the 4 Local nodes (disable the 2 Cloud nodes if you want
   local only). Deploy.
2. Confirm the token is set in *Stream to InfluxDB* — no `401` in the log.
3. Start Grafana and the local containers (recipe B).
4. Open Grafana; charts fill within a few seconds.

Switching never deletes data. Each database keeps what it already received; the
path you turn off simply has a gap while it's off.

---

## 5. Mixing and matching

The pieces are independent, so you can combine them.

| I want… | Do this |
|---|---|
| Dashboard **and** Grafana | Recipe C |
| Dashboard, but **no logins** | Leave `SUPABASE_*` and `VITE_SUPABASE_*` blank; rebuild the frontend. Machines come from `MACHINES` in `.env` |
| Dashboard **with** logins | Fill `SUPABASE_*` (`.env`) and `VITE_SUPABASE_*` (`pdm-frontend/.env.local`), then `docker compose up -d api` and `npm run build` |
| Local history, cloud dashboard | Recipe C |
| Local database, **no Grafana** | Skip the `grafana` container; browse with Explorer (:8888) |
| Only status log in Postgres | Enable just the last 3 Local nodes (*Filter*, *Format*, *Commit*) |
| Grafana without Postgres | Fine — only the **Motor Status** panel goes blank |
| Cloud without the local databases | Recipe A: don't start `influxdb`/`postgres`/`grafana` |
| Demo data with no hardware | Local only: `python tools/demo_machine.py stream`. It shows in Grafana, **not** in the dashboard |

### What each screen needs (cheat sheet)

| Screen | Reads from | Needs |
|---|---|---|
| Grafana :3000 | Local InfluxDB + Postgres | Local nodes enabled · `INFLUXDB3_AUTH_TOKEN` |
| React dashboard :4173 | Cloud InfluxDB (via FastAPI :8000) | Cloud nodes enabled · internet · `INFLUX_TOKEN` |
| Dashboard logins | Supabase | `SUPABASE_*` + `VITE_SUPABASE_*` |

---

## 6. Quick checks after switching

| Check | How | Good result |
|---|---|---|
| Node-RED is sending | Open :1880, look at the debug panel | Messages appearing every second |
| Local is arriving | Explorer (:8888) or the `influxdb3 query` in `Local.md` §5 | Rows with a recent `time` |
| Cloud is arriving | `curl http://localhost:8000/api/machines/MOTOR001/latest` | Readings, not `{}` |
| API is healthy | `curl http://localhost:8000/api/health` | `"telemetry_blocked":null` |
| Dashboard is live | Load :4173 | Machine card shows RUNNING or IDLE |
| Grafana is live | Load :3000 | Charts moving |

If the dashboard shows OFFLINE but Grafana is moving, the local path works and
the cloud path doesn't: check the MQTT nodes, the broker `124.217.236.82:1883`,
and `PassOver.md` §14.

---

## 7. Common mistakes

- **Expecting the dashboard to show local data.** It can't — see §1.
- **Disabling the wrong nodes.** Only the six listed in §2 are switches.
- **Forgetting to Deploy** after enabling or disabling a node.
- **Re-importing `flows.json`** and wondering why Grafana went blank — the file
  has the Local nodes disabled and the token is not stored in it.
- **Pointing *Stream to InfluxDB* at the cloud.** Never. It is local only.
- **Using `npm run dev`** for the dashboard. Always `build` + `preview`.

---

*Not verified by running: written from the repository's code and configuration.
The enable/disable steps, container commands and curl checks were not executed
here, and no PLC, MQTT broker or cloud database was available to test against.*
