# Local.md — The Local Path (Grafana + local InfluxDB + Postgres)

**How the local half of this system works.** `PassOver.md` explains mostly the
**cloud path** (MQTT → Novaflow → cloud InfluxDB → FastAPI → React dashboard).
This file explains the other half, which runs entirely on the acquisition PC and
needs no internet. To move between the two, see `SwitchPaths.md`.

---

## 1. The local path in one picture

```
 ┌─────────────┐  Modbus TCP   ┌──────────┐   writes    ┌────────────────────┐
 │ Inovance PLC│ ────────────▶ │ Node-RED │ ──────────▶ │ Local InfluxDB 3   │
 │ 192.168.0.30│  every 1 s    │  :1880   │  every 1 s  │ :8181  (real units)│
 └─────────────┘               └────┬─────┘             └─────────┬──────────┘
                                    │                              │ SQL
                                    │ only when status             ▼
                                    │ changes               ┌─────────────┐
                                    ▼                       │   Grafana   │
                             ┌─────────────┐   SQL          │    :3000    │
                             │  Postgres   │ ─────────────▶ │ (dashboard) │
                             │ :5432       │                └─────────────┘
                             └─────────────┘
```

- **Local InfluxDB 3 Core** stores every reading (voltage, vibration, …) in real
  units — `vibration_x = 1.24` means 1.24 mm/s.
- **Postgres** stores one row each time the motor's **status changes**
  (stopped → running, and so on).
- **Grafana** draws both. It is the original prototype dashboard.
- **InfluxDB Explorer** (`:8888`) is a web page for looking at the raw rows.

Nothing here touches the internet, Novaflow, Supabase or the React dashboard.

---

## 2. What each piece does

| Piece | Port | Login | Job |
|---|---|---|---|
| Node-RED | 1880 | none | Reads the PLC, writes to the local database and Postgres |
| Local InfluxDB 3 Core | 8181 | admin token (`INFLUXDB3_AUTH_TOKEN`) | Stores readings. Database `machine_telemetry`, table `motor_metrics` |
| InfluxDB Explorer | 8888 | the same token | Browse and query the readings by hand |
| Postgres | 5432 | `admin` / `admin`, database `motor_db` | Table `machine_activity_logs` — status history |
| Grafana | 3000 | `admin` / `admin` | The "Motor 01 (Testing PM)" dashboard |
| Mosquitto | 1883 | none | A local MQTT broker nothing uses. It only exists so the stack starts as designed |

All of them are defined in `docker-compose.yml`.

---

## 3. How one reading travels

1. The PLC holds the value (X vibration in register D406 = `124`).
2. Node-RED's **Map, Scale & Process Buffer** function converts it:
   `124 ÷ 100 = 1.24`.
3. **Stream to InfluxDB** writes a row to table `motor_metrics`:
   `machine_id = motor01`, `vibration_x = 1.24`, plus every other field.
4. Grafana runs SQL against that table and draws the chart.

The status path is separate:

1. The function also outputs `status_code` (0 E-stop, 1 stopped, 2 running).
2. **Filter Status Change** lets a message through **only when the value
   changes**.
3. **Format Postgres SQL** builds an `INSERT` and **Commit Log to Postgres**
   runs it.
4. Grafana's **Motor Status** panel shows the newest row.

### The local data looks different from the cloud data

| | Local (this file) | Cloud (PassOver) |
|---|---|---|
| Database | InfluxDB 3 Core | InfluxDB 2.8 |
| Query language | **SQL** | **Flux** |
| Table | `motor_metrics` | `MOTOR` |
| Machine label | `machine_id = motor01` | `device_id = MOTOR001` |
| X vibration | `vibration_x = 1.24` | `motor_VBR_VX = 124` |
| Units | real | scaled integers |

---

## 4. ⚠ The local nodes are switched OFF in the committed flow

The `node-red-flows/flows.json` in this repo has these four nodes **disabled**:

- Stream to InfluxDB
- Filter Status Change
- Format Postgres SQL
- Commit Log to Postgres

So a fresh import sends data to the cloud only. **Grafana will be empty until
you enable them** (§5 step 5). Importing the file again switches them back off.

---

## 5. Setting up the local path

Do this on the PC that is wired to the PLC (or any PC, if you only want the
demo data in §8).

1. **Create the Mosquitto config** (folder is gitignored; the container
   crash-loops without it): `mosquitto/config/mosquitto.conf`
   ```
   listener 1883
   allow_anonymous true
   listener 9001
   protocol websockets
   ```
2. **Start InfluxDB and mint a token** (shown only once):
   ```bash
   cp .env.example .env
   docker compose up -d influxdb
   docker compose exec influxdb influxdb3 create token --admin
   ```
   Put it in `.env` as `INFLUXDB3_AUTH_TOKEN=apiv3_…`.
3. **Start everything local:**
   ```bash
   docker compose up -d --build influxdb influxdb-explorer postgres grafana node-red mosquitto
   ```
4. **Import the flow:** http://localhost:1880 → Menu → Import →
   `node-red-flows/flows.json` → Deploy.
5. **Turn on the local nodes.** Double-click each of the four nodes in §4 and set
   it to **Enabled**. Then:
   - **Stream to InfluxDB** → edit its server: Version `2.0`, URL
     `http://influxdb:8181`, Token = your `apiv3_…` token, Organization
     `Factory_Module`, Bucket `machine_telemetry`. **Type the token in the
     editor** — it cannot be loaded any other way.
   - **Modbus client**: host `192.168.0.30`, port `502`, unit id `1`.
6. **Deploy.**
7. **Check it:**
   - Node-RED log has no `401 Unauthorized`.
   - Explorer (http://localhost:8888) shows new rows in `motor_metrics`:
     ```bash
     docker compose exec influxdb influxdb3 query --database machine_telemetry \
       --token "$INFLUXDB3_AUTH_TOKEN" "SELECT * FROM motor_metrics ORDER BY time DESC LIMIT 5"
     ```
   - http://localhost:3000 (admin / admin) shows the dashboard filling in.

Databases and tables are created automatically on the first write. Postgres'
table is created by `postgres/init/` **only the first time the Postgres volume
is created**.

---

## 6. Grafana

- Loaded automatically from `grafana/dashboards/motor01-prototype.json` every
  time Grafana starts. You do not import anything by hand.
- Two data sources are provisioned from `grafana/provisioning/datasources/`:
  **InfluxDB** (SQL, database `machine_telemetry`, uses `INFLUXDB3_AUTH_TOKEN`)
  and **PostgreSQL** (database `motor_db`).
- The dashboard UIDs are written into the dashboard JSON. If you change a UID in
  one place, change it in the other, or panels go blank.
- Changes made in the Grafana web page are **lost on restart** unless you export
  the dashboard back into `grafana/dashboards/motor01-prototype.json`.
- After editing a provisioning file: `docker compose restart grafana`.
- The panels cover vibration (3-axis), displacement, acceleration, frequencies,
  voltage/current/torque/power, health score, anomaly detection, root-cause
  history and motor status. They use the same ISO limits as the React dashboard
  (1.8 warning / 4.5 critical mm/s) but **hard-coded in the SQL**.

---

## 7. Day to day

```bash
docker compose ps                    # what's running
docker compose logs -f node-red      # follow the acquisition log
docker compose restart grafana       # after changing a Grafana file
docker compose down                  # stop all (data is kept)
```

Data lives in gitignored folders: `influxdb_data/`, `postgres_data/`,
`grafana_data/`, `node_red_data/`. Deleting one erases that data.

---

## 8. Demo data (no hardware)

```bash
python tools/demo_machine.py stream              # live, 1 per second, Ctrl+C to stop
python tools/demo_machine.py backfill --hours 6  # fill the last 6 hours
python tools/demo_machine.py purge               # remove everything it wrote
```

It writes under `machine_id = demo01` and reads `INFLUXDB3_AUTH_TOKEN` from
`.env`. **Never write synthetic data under `motor01` or any real machine.**

Heads-up: the Grafana panels have **no `machine_id` filter**, so demo rows and
real rows appear mixed in the same charts. Purge the demo data when finished.
The demo data never reaches the React dashboard.

---

## 9. What the local path cannot do

- **The React dashboard cannot read it.** FastAPI speaks Flux to InfluxDB 2.x;
  the local store is InfluxDB 3 and speaks SQL. There is no setting that
  bridges them. (`INFLUX_SCHEMA=native` is for a 2.x server holding real-unit
  data — not this container.)
- **No logins, no per-machine settings.** Those are Supabase and belong to the
  dashboard.
- **Grafana limits are fixed** in the SQL; the dashboard's per-machine
  standards are not applied.
- **`motor01` is a different name from `MOTOR001`.** The flow tags the local
  store `motor01` and the cloud `MOTOR001`. They are independent.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Grafana panels empty, Explorer has no rows | The four local nodes are still disabled (§4), or the flow isn't deployed | Enable them, Deploy |
| Node-RED log: repeated `401 Unauthorized` | Token missing or wrong in **Stream to InfluxDB** | Type the `apiv3_…` token in the editor, Deploy |
| Explorer shows fresh rows but Grafana is blank | Wrong `INFLUXDB3_AUTH_TOKEN` in `.env`; Grafana read the old one | Fix `.env`, `docker compose up -d grafana` |
| Queries fail after a day or two of data | InfluxDB Core never compacts files and hits its file cap (`INFLUXDB3_QUERY_FILE_LIMIT`, set to 20000 in compose) | Raise the limit, or set a retention period on `machine_telemetry` |
| Motor Status panel blank | No status change has happened yet, or the Postgres table is missing | Change the motor state once; check the table exists |
| `machine_activity_logs` doesn't exist | Postgres volume predates `postgres/init/` | Run `postgres/init/01-machine-activity-logs.sql` by hand: `docker compose exec -T postgres psql -U admin -d motor_db < postgres/init/01-machine-activity-logs.sql` |
| `mosquitto` keeps restarting | `mosquitto/config/mosquitto.conf` missing | Create it (§5 step 1) |
| Duplicate rows (~3 per second) | Known: the join node re-emits on most replies | Harmless locally; see PassOver §16 |
| Times are 8 hours off | A container running UTC | `TZ: Asia/Kuala_Lumpur` is set in compose for every service that needs it |

Postgres is easy to check directly:

```bash
docker compose exec postgres psql -U admin -d motor_db \
  -c "SELECT * FROM machine_activity_logs ORDER BY changed_at DESC LIMIT 5;"
```

---

## 11. Rules for the local path

1. **Never point "Stream to InfluxDB" at the cloud server.** It is the local
   store only.
2. **Don't edit the working *Map, Scale & Process Buffer* function** to add
   outputs. Add a new wire and a new function instead.
3. **Never write synthetic data under a real machine's ID.**
4. **Passwords are development defaults** (`admin` / `admin`, unencrypted
   Node-RED credentials). Change them before any wider deployment.
5. **Never commit `.env`** or any token.

---

*Not verified by running: this file was written from the repository's code and
configuration. The stack was not started and no PLC or database was queried.*
