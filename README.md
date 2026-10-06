# Predictive Maintenance Module

A condition-monitoring dashboard for an industrial motor. It shows live
vibration, temperature, speed and electrical readings, scores machine health
against ISO vibration standards, flags statistical anomalies, and classifies
faults — so plant operators can see a problem developing before it becomes a
breakdown.

## How it works

```
 PLC + vibration sensor                                   Operator's browser
        │ Modbus TCP                                              ▲
        ▼                                                         │
   Node-RED  ──MQTT──▶  Novaflow broker  ──▶  Cloud InfluxDB  ──▶  FastAPI  ──▶  React dashboard
   (polls 1×/s)        (company, remote)     (company, remote)    (reads only)
```

1. **Node-RED** polls the PLC over Modbus TCP every second, converts the raw
   registers into readings, and publishes them to the company's MQTT broker.
2. **Novaflow's ingest** (not part of this repo) stores those messages in the
   company's cloud **InfluxDB**.
3. **FastAPI** (`pdm-backend/`) reads from that InfluxDB, converts the stored
   values back into real units, and computes health, anomalies and faults.
4. **The React dashboard** (`pdm-frontend/`) shows it all. Logins, the machine
   list and saved settings live in **Supabase**.

This project only *reads* the cloud database — it never writes to it.

Node-RED also writes a copy to a **local** InfluxDB, which only the Grafana
prototype dashboard uses. The main dashboard does not read it.

## What you need

- Docker Desktop
- Node.js 22.13 or newer (20.19+ also works)
- A **read-only token** for the cloud InfluxDB bucket
- Optionally, a Supabase project (for logins and saving settings)

## Setup

```bash
# 1. Configuration
cp .env.example .env
#    Edit .env: set INFLUX_TOKEN, and INFLUX_ALLOW_INSECURE=true
#    (needed until the InfluxDB server has HTTPS).

# 2. Start the backend services
docker compose up -d --build

# 3. Build and serve the dashboard
cd pdm-frontend
cp .env.example .env.local     # add Supabase URL + anon key, or leave blank for no login
npm ci
npm run build
npm run preview                # → http://localhost:4173
```

That is enough to see live data on the dashboard.

**To collect data from a PLC yourself** (only needed on the machine connected
to the PLC): open Node-RED at http://localhost:1880, import
`node-red-flows/flows.json` from the menu, set the Modbus host to the PLC's IP
address, and click **Deploy**.

**To enable logins:** run `supabase/schema.sql` in the Supabase SQL Editor,
create a user under *Authentication → Users*, and put the same Supabase URL and
anon key in both `.env` and `pdm-frontend/.env.local`:

- **URL** — *Integrations → Data API → API URL*, without the trailing
  `/rest/v1/` (just `https://<project>.supabase.co`).
- **Anon key** — *Project Settings → API Keys → Legacy anon, service_role API
  keys* → the **anon public** key. Never use the `service_role` key.

Rebuild the frontend afterwards — those values are baked in at build time.

> Always use `npm run build` + `npm run preview`. `npm run dev` leaks memory at
> this data rate and eventually crashes the browser tab.

## Where things are

| Service | Address |
|---|---|
| Dashboard | http://localhost:4173 |
| API | http://localhost:8000/api/health |
| Node-RED | http://localhost:1880 |
| Grafana (prototype) | http://localhost:3000 |
| Local InfluxDB Explorer | http://localhost:8888 |

| Folder | Contents |
|---|---|
| `pdm-backend/` | FastAPI service — all database access and analytics |
| `pdm-frontend/` | React dashboard |
| `node-red-flows/` | The data-acquisition flow |
| `supabase/` | Database schema for logins, machines and settings |
| `grafana/`, `postgres/` | The local prototype dashboard and its status log |
| `tools/` | Optional demo-data generator (feeds Grafana only) |

**`PassOver.md`** is the full handover guide: how every part works, where the
code is, configuration, common tasks and troubleshooting. `CLAUDE.md` has the
engineering notes — the rules that must not be broken, and problems that have
already been solved once.
