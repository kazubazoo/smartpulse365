import os
import re
import socket
import struct
import time as _time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client_3 import InfluxDBClient3

app = FastAPI(title="Predictive Maintenance API")

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:4173"
    ).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = InfluxDBClient3(
    host=os.environ.get("INFLUXDB_HOST", "http://influxdb:8181"),
    token=os.environ.get("INFLUXDB3_AUTH_TOKEN"),
    database=os.environ.get("INFLUXDB_DATABASE", "machine_telemetry"),
)


# --------------------------------------------------------------------------
# Machine registry
#
# MACHINES lists the assets this deployment is responsible for, as
# "id:Display Name" pairs. A machine stays listed when it stops reporting, so
# the operator sees that it went offline rather than it silently vanishing.
# Anything discovered in the data but not configured is appended automatically.
# --------------------------------------------------------------------------
DEFAULT_MACHINE = os.environ.get("DEFAULT_MACHINE_ID", "motor01")
ONLINE_WINDOW_SECONDS = int(os.environ.get("ONLINE_WINDOW_SECONDS", "30"))
MACHINE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _parse_machines() -> dict[str, str]:
    raw = os.environ.get("MACHINES", f"{DEFAULT_MACHINE}:Motor 01")
    out: dict[str, str] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        mid, _, name = part.partition(":")
        mid = mid.strip()
        if MACHINE_ID_RE.match(mid):
            out[mid] = name.strip() or mid
    return out or {DEFAULT_MACHINE: "Motor 01"}


CONFIGURED_MACHINES = _parse_machines()

_schema_cache: dict[str, object] = {"checked_at": 0.0, "has_machine_id": False}


def _has_machine_column() -> bool:
    """Whether the telemetry table carries a machine_id tag yet.

    A single-motor deployment that has never written the tag has no such
    column, and referencing it would fail the query outright — so every
    machine filter is suppressed in that case and all data is treated as
    belonging to the default machine.
    """
    now = _time.time()
    if now - float(_schema_cache["checked_at"]) < 60:
        return bool(_schema_cache["has_machine_id"])

    try:
        rows = client.query(
            query=(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'motor_metrics' AND column_name = 'machine_id'"
            ),
            language="sql",
        ).to_pylist()
        _schema_cache["has_machine_id"] = len(rows) > 0
    except Exception:
        _schema_cache["has_machine_id"] = False

    _schema_cache["checked_at"] = now
    return bool(_schema_cache["has_machine_id"])


def validate_machine(machine_id: str) -> str:
    if not MACHINE_ID_RE.match(machine_id):
        raise HTTPException(status_code=400, detail="Invalid machine id")
    return machine_id


def machine_clause(machine_id: str, prefix: str = "AND") -> str:
    """SQL predicate restricting a query to one machine.

    Rows written before the tag existed have a NULL machine_id; they are
    attributed to the default machine so historical data is not orphaned.
    """
    if not _has_machine_column():
        return ""
    if machine_id == DEFAULT_MACHINE:
        return f" {prefix} (machine_id = '{machine_id}' OR machine_id IS NULL)"
    return f" {prefix} machine_id = '{machine_id}'"


# --------------------------------------------------------------------------
# Authentication (optional — enabled by setting SUPABASE_URL + SUPABASE_ANON_KEY)
# --------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
AUTH_ENABLED = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
_TOKEN_TTL = 60
_token_cache: dict[str, tuple[float, dict]] = {}


def require_user(authorization: Optional[str] = Header(default=None)):
    if not AUTH_ENABLED:
        return None

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    now = _time.time()

    cached = _token_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]

    try:
        resp = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Auth backend unreachable: {exc}")

    if resp.status_code != 200:
        _token_cache.pop(token, None)
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user = resp.json()
    _token_cache[token] = (now + _TOKEN_TTL, user)

    if len(_token_cache) > 512:
        for stale in [k for k, (exp, _) in _token_cache.items() if exp <= now]:
            _token_cache.pop(stale, None)

    return user


# --------------------------------------------------------------------------
# Field sets
# --------------------------------------------------------------------------
PEAK_FIELDS = [
    "vibration_x", "vibration_y", "vibration_z",
    "disp_x", "disp_y", "disp_z",
]
AVG_FIELDS = [
    "vib_freq_x", "vib_freq_y", "vib_freq_z",
    "accel_x", "accel_y", "accel_z",
    "rpm", "voltage", "frequency", "speed_command_hz",
    "power", "current", "torque", "temperature", "sensor_chip_temp",
]
ALL_FIELDS = PEAK_FIELDS + AVG_FIELDS
FIELD_LIST = ", ".join(ALL_FIELDS)


class Thresholds:
    """Analytic limits, supplied per-request by the dashboard."""

    def __init__(self, vib_warn=1.8, vib_critical=4.5, vib_scale=4.5,
                 temp_warn=50.0, temp_critical=60.0):
        self.vib_warn = vib_warn
        self.vib_critical = vib_critical
        self.vib_scale = max(vib_scale, 0.001)
        self.temp_warn = temp_warn
        self.temp_critical = temp_critical


def thresholds(
    vib_warn: float = 1.8,
    vib_critical: float = 4.5,
    vib_scale: float = 4.5,
    temp_warn: float = 50.0,
    temp_critical: float = 60.0,
) -> Thresholds:
    return Thresholds(vib_warn, vib_critical, vib_scale, temp_warn, temp_critical)


def _bucket_seconds(seconds: int, max_points: int) -> int:
    if max_points <= 0 or seconds <= max_points:
        return 0
    return max(2, -(-seconds // max_points))


def compute_health(row, t: Thresholds):
    vx = row.get("vibration_x") or 0
    vy = row.get("vibration_y") or 0
    vz = row.get("vibration_z") or 0
    temp = row.get("temperature") or 0
    peak = max(vx, vy, vz)

    health_percent = max(0, min(100, round(100 - (peak / t.vib_scale * 100))))
    severe = t.vib_warn + (t.vib_critical - t.vib_warn) * 0.25

    if temp > t.temp_critical:
        status_label = "CRITICAL: OVERHEAT"
    elif vz > t.vib_warn:
        status_label = "ALARM: Axial Misalignment"
    elif vx > t.vib_warn or vy > t.vib_warn:
        status_label = "WARNING: Radial Unbalance/Looseness"
    elif temp > t.temp_warn:
        status_label = "WATCH: Elevated Temperature"
    else:
        status_label = "SYSTEM OPTIMAL"

    if vy > severe and vy > vx:
        commentary = ("Vertical looseness detected. High Y-axis energy suggests loose "
                      "mounting bolts or a soft-foot condition.")
    elif temp > t.temp_critical:
        commentary = ("Thermal overload detected. High risk of bearing lubricant "
                      "breakdown. Check the cooling fan.")
    elif vz > vx and vz > vy and vz > severe:
        commentary = ("Axial vibration is dominant, suggesting coupling misalignment "
                      "or thrust bearing wear.")
    elif vx > severe or vy > severe:
        commentary = ("Radial vibration detected. Likely cause: rotor unbalance or "
                      "loose mounting bolts.")
    else:
        commentary = ("Vibration signatures are harmonized. Motor is within "
                      "ISO 10816-3 Zone A (Optimal).")

    return {
        "health_percent": health_percent,
        "status_label": status_label,
        "ai_commentary": commentary,
        "peak_vibration": peak,
    }


def _is_missing_table(exc: Exception) -> bool:
    """A telemetry table only springs into existence on the first write.

    Before any machine has reported, querying it is a legitimate empty result,
    not a server error — so the dashboard must render an empty state rather
    than an error banner on a fresh install.
    """
    text = str(exc).lower()
    return "not found" in text and "motor_metrics" in text


def run_query(query: str) -> list[dict]:
    try:
        return client.query(query=query, language="sql").to_pylist()
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise HTTPException(status_code=502, detail=f"Telemetry query failed: {exc}")


@app.get("/api/health")
def service_health():
    return {"status": "ok", "auth_enabled": AUTH_ENABLED}


ANOMALY_WINDOW_SECONDS = int(os.environ.get("ANOMALY_WINDOW_SECONDS", "3600"))


def _run_state(online: bool, status_code) -> str:
    """Distinguish 'not reporting' from 'reporting but not turning'.

    OFFLINE means the acquisition path is silent — nothing is arriving. IDLE
    means data is flowing and the motor is simply stopped. Conflating the two
    hides a dead sensor behind a stopped machine.
    """
    if not online:
        return "OFFLINE"
    code = int(status_code) if status_code is not None else -1
    return {0: "E-STOP", 1: "IDLE", 2: "RUNNING"}.get(code, "UNKNOWN")


def _anomaly_counts(seconds: int, sigma: float, lookback: int, floor: float
                    ) -> dict[str, int]:
    """Anomalies per machine over the recent window, for the fleet cards."""
    tagged = _has_machine_column()
    partition = "PARTITION BY machine_id " if tagged else ""
    select_id = "machine_id, " if tagged else ""
    group_by = "GROUP BY machine_id" if tagged else ""

    query = f"""
        SELECT {select_id}COUNT(*) AS anomalies
        FROM (
            SELECT {select_id}peak_vibration,
                   moving_avg + (std_dev * {sigma}) AS upper_bound
            FROM (
                SELECT {select_id}time,
                       GREATEST(vibration_x, vibration_y, vibration_z) AS peak_vibration,
                       AVG(GREATEST(vibration_x, vibration_y, vibration_z)) OVER (
                           {partition}ORDER BY time
                           ROWS BETWEEN {lookback} PRECEDING AND CURRENT ROW
                       ) AS moving_avg,
                       STDDEV(GREATEST(vibration_x, vibration_y, vibration_z)) OVER (
                           {partition}ORDER BY time
                           ROWS BETWEEN {lookback} PRECEDING AND CURRENT ROW
                       ) AS std_dev
                FROM "motor_metrics"
                WHERE time >= now() - INTERVAL '{seconds} seconds'
            ) AS stats
        ) AS flagged
        WHERE peak_vibration > upper_bound AND peak_vibration > {floor}
        {group_by}
    """

    try:
        rows = client.query(query=query, language="sql").to_pylist()
    except Exception:
        return {}

    if not tagged:
        return {DEFAULT_MACHINE: rows[0]["anomalies"] if rows else 0}
    return {
        (r.get("machine_id") or DEFAULT_MACHINE): r["anomalies"]
        for r in rows
    }


@app.get("/api/machines")
def list_machines(
    ids: str = "",
    sigma: float = 3.0,
    lookback: int = 20,
    anomaly_floor: float = 0.5,
    t: Thresholds = Depends(thresholds),
    user=Depends(require_user),
):
    """Fleet roll-up: every machine with its latest reading and recent anomalies.

    `ids` lets the dashboard supply the machine list it holds (machines are
    managed in the UI and stored in Supabase). Without it the MACHINES
    environment variable is used, so the API still works standalone.
    """
    tagged = _has_machine_column()

    if tagged:
        query = """
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY machine_id ORDER BY time DESC
                ) AS rn
                FROM "motor_metrics"
                WHERE time >= now() - INTERVAL '7 days'
            ) AS ranked
            WHERE rn = 1
        """
    else:
        query = 'SELECT * FROM "motor_metrics" ORDER BY time DESC LIMIT 1'

    try:
        rows = client.query(query=query, language="sql").to_pylist()
    except Exception:
        rows = []

    # Untagged rows partition separately but belong to the default machine —
    # keep whichever of the two is newer.
    latest_by_id: dict[str, dict] = {}
    for row in rows:
        mid = row.get("machine_id") or DEFAULT_MACHINE
        existing = latest_by_id.get(mid)
        if existing is None or str(row.get("time")) > str(existing.get("time")):
            latest_by_id[mid] = row

    requested = [m.strip() for m in ids.split(",") if MACHINE_ID_RE.match(m.strip())]
    if requested:
        names = {mid: mid for mid in requested}
    else:
        names = dict(CONFIGURED_MACHINES)
    for mid in latest_by_id:
        names.setdefault(mid, mid)

    anomalies_by_id = _anomaly_counts(
        ANOMALY_WINDOW_SECONDS, max(0.1, min(sigma, 10.0)),
        max(2, min(lookback, 500)), anomaly_floor,
    )

    out = []
    for mid, name in names.items():
        row = latest_by_id.get(mid)
        entry = {
            "id": mid,
            "name": name,
            "online": False,
            "run_state": "OFFLINE",
            "last_seen": None,
            "age_seconds": None,
            "status_code": None,
            "health_percent": None,
            "status_label": None,
            "peak_vibration": None,
            "temperature": None,
            "frequency": None,
            "rpm": None,
            "anomaly_count": anomalies_by_id.get(mid, 0),
            "anomaly_window_seconds": ANOMALY_WINDOW_SECONDS,
        }

        if row:
            raw_time = str(row.get("time"))
            entry["last_seen"] = raw_time
            try:
                stamp = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                if stamp.tzinfo is None:
                    stamp = stamp.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - stamp).total_seconds()
                entry["age_seconds"] = round(age, 1)
                entry["online"] = age <= ONLINE_WINDOW_SECONDS
            except ValueError:
                entry["online"] = False

            health = compute_health(row, t)
            entry.update({
                "status_code": row.get("status_code"),
                "health_percent": health["health_percent"],
                "status_label": health["status_label"],
                "peak_vibration": health["peak_vibration"],
                "temperature": row.get("temperature"),
                "frequency": row.get("frequency"),
                "rpm": row.get("rpm"),
            })

        entry["run_state"] = _run_state(entry["online"], entry["status_code"])
        out.append(entry)

    return out


@app.get("/api/machines/{machine_id}/latest")
def latest(machine_id: str, user=Depends(require_user)):
    validate_machine(machine_id)
    query = f"""
        SELECT * FROM "motor_metrics"
        WHERE 1=1{machine_clause(machine_id)}
        ORDER BY time DESC LIMIT 1
    """
    rows = run_query(query)
    return rows[0] if rows else {}


@app.get("/api/machines/{machine_id}/history")
def history(machine_id: str, seconds: int = 300, max_points: int = 1500,
            user=Depends(require_user)):
    validate_machine(machine_id)
    seconds = max(1, min(seconds, 7 * 24 * 3600))
    bucket = _bucket_seconds(seconds, max_points)
    where = f"time >= now() - INTERVAL '{seconds} seconds'{machine_clause(machine_id)}"

    if bucket == 0:
        query = f"""
            SELECT time, {FIELD_LIST}
            FROM "motor_metrics"
            WHERE {where}
            ORDER BY time ASC
        """
    else:
        aggs = [f"MAX({f}) AS {f}" for f in PEAK_FIELDS]
        aggs += [f"AVG({f}) AS {f}" for f in AVG_FIELDS]
        query = f"""
            SELECT date_bin(INTERVAL '{bucket} seconds', time) AS time,
                   {', '.join(aggs)}
            FROM "motor_metrics"
            WHERE {where}
            GROUP BY 1
            ORDER BY 1 ASC
        """

    return {"bucket_seconds": bucket, "rows": run_query(query)}


@app.get("/api/machines/{machine_id}/history/latest")
def history_latest(machine_id: str, since: str, user=Depends(require_user)):
    validate_machine(machine_id)
    since = since.replace("'", "")
    query = f"""
        SELECT time, {FIELD_LIST}
        FROM "motor_metrics"
        WHERE time > CAST('{since}' AS TIMESTAMP){machine_clause(machine_id)}
        ORDER BY time ASC
    """
    return run_query(query)


@app.get("/api/machines/{machine_id}/health")
def health(machine_id: str, t: Thresholds = Depends(thresholds),
           user=Depends(require_user)):
    validate_machine(machine_id)
    query = f"""
        SELECT * FROM "motor_metrics"
        WHERE 1=1{machine_clause(machine_id)}
        ORDER BY time DESC LIMIT 1
    """
    rows = run_query(query)
    return compute_health(rows[0], t) if rows else {}


@app.get("/api/machines/{machine_id}/anomalies")
def anomalies(machine_id: str, seconds: int = 300, sigma: float = 3.0,
              lookback: int = 20, max_points: int = 1500,
              user=Depends(require_user)):
    validate_machine(machine_id)
    seconds = max(1, min(seconds, 7 * 24 * 3600))
    sigma = max(0.1, min(sigma, 10.0))
    lookback = max(2, min(lookback, 500))
    bucket = _bucket_seconds(seconds, max_points)
    where = f"time >= now() - INTERVAL '{seconds} seconds'{machine_clause(machine_id)}"

    if bucket == 0:
        source = f"""
            SELECT time,
                   GREATEST(vibration_x, vibration_y, vibration_z) AS peak_vibration
            FROM "motor_metrics"
            WHERE {where}
        """
    else:
        source = f"""
            SELECT date_bin(INTERVAL '{bucket} seconds', time) AS time,
                   MAX(GREATEST(vibration_x, vibration_y, vibration_z)) AS peak_vibration
            FROM "motor_metrics"
            WHERE {where}
            GROUP BY 1
        """

    query = f"""
        SELECT time, peak_vibration,
               moving_avg + (std_dev * {sigma}) AS upper_bound,
               moving_avg - (std_dev * {sigma}) AS lower_bound,
               moving_avg
        FROM (
            SELECT time, peak_vibration,
                   AVG(peak_vibration) OVER (
                       ORDER BY time ROWS BETWEEN {lookback} PRECEDING AND CURRENT ROW
                   ) AS moving_avg,
                   STDDEV(peak_vibration) OVER (
                       ORDER BY time ROWS BETWEEN {lookback} PRECEDING AND CURRENT ROW
                   ) AS std_dev
            FROM ({source}) AS src
        ) AS stats
        ORDER BY time ASC
    """
    return run_query(query)


@app.get("/api/machines/{machine_id}/root-cause-history")
def root_cause_history(machine_id: str, limit: int = 10, seconds: int = 0,
                       t: Thresholds = Depends(thresholds),
                       user=Depends(require_user)):
    validate_machine(machine_id)
    limit = max(1, min(limit, 500))
    warn, crit, tw, tc = t.vib_warn, t.vib_critical, t.temp_warn, t.temp_critical

    window = ""
    if seconds > 0:
        window = f"AND time >= now() - INTERVAL '{min(seconds, 7 * 24 * 3600)} seconds'"

    query = f"""
        SELECT time,
            CASE
                WHEN temperature > {tc} THEN 'Thermal Overload'
                WHEN vibration_z > {warn} THEN 'Axial Misalignment'
                WHEN vibration_y > {warn} THEN 'Vertical Looseness'
                WHEN vibration_x > {warn} THEN 'Horizontal Unbalance'
                WHEN temperature > {tw} THEN 'Elevated Temperature'
            END AS fault_type,
            CASE
                WHEN temperature > {tc} THEN 'Immediate shutdown: high risk of fire or winding failure.'
                WHEN vibration_z > {crit} THEN 'CRITICAL: vibration is damaging the motor (Zone D).'
                WHEN vibration_z > {warn} THEN 'Urgent: bearings and couplings under stress (Zone C).'
                WHEN vibration_y > {warn} THEN 'Caution: foundation bolts are loose; inspect mounting.'
                WHEN vibration_x > {warn} THEN 'Maintenance: schedule a cleaning or balancing.'
                WHEN temperature > {tw} THEN 'Monitor: running warmer than the configured normal band.'
            END AS urgency
        FROM "motor_metrics"
        WHERE (vibration_x > {warn} OR vibration_y > {warn} OR vibration_z > {warn}
               OR temperature > {tw})
        {window}{machine_clause(machine_id)}
        ORDER BY time DESC
        LIMIT {limit}
    """
    return run_query(query)


# --------------------------------------------------------------------------
# Connectivity probe
#
# "Offline" on the dashboard means no telemetry is arriving — it says nothing
# about *why*. This endpoint answers the next question: is the device itself
# reachable on the network right now? Run from the API container, so it tests
# the same network path the acquisition layer would use.
# --------------------------------------------------------------------------
def _modbus_probe(host: str, port: int, unit_id: int, timeout: float = 3.0) -> dict:
    started = _time.perf_counter()

    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            connect_ms = round((_time.perf_counter() - started) * 1000, 1)
            sock.settimeout(timeout)

            # Modbus TCP ADU: transaction, protocol, length, unit, then a
            # Read Holding Registers (fc 3) for one register at address 0.
            request = struct.pack(">HHHBBHH", 1, 0, 6, unit_id, 3, 0, 1)
            sock.sendall(request)

            header = sock.recv(8)
            if len(header) < 8:
                return {
                    "reachable": True, "responded": False, "connect_ms": connect_ms,
                    "detail": "TCP connected, but the device sent no Modbus reply.",
                }

            _, _, _, resp_unit, function = struct.unpack(">HHHBB", header)
            total_ms = round((_time.perf_counter() - started) * 1000, 1)

            if function == 3:
                return {
                    "reachable": True, "responded": True, "connect_ms": connect_ms,
                    "response_ms": total_ms, "unit_id": resp_unit,
                    "detail": "Modbus device responded to a holding-register read.",
                }
            if function == 0x83:
                # An exception reply still proves a Modbus device is present.
                return {
                    "reachable": True, "responded": True, "connect_ms": connect_ms,
                    "response_ms": total_ms, "unit_id": resp_unit,
                    "detail": ("Device replied with a Modbus exception — it is present, "
                               "but register 0 is not readable on this unit id."),
                }
            return {
                "reachable": True, "responded": True, "connect_ms": connect_ms,
                "detail": f"Unexpected Modbus function code {function} in reply.",
            }

    except socket.timeout:
        return {"reachable": False, "responded": False,
                "detail": f"Timed out after {timeout}s connecting to {host}:{port}."}
    except ConnectionRefusedError:
        return {"reachable": False, "responded": False,
                "detail": f"Connection refused by {host}:{port} — host is up but nothing is listening."}
    except socket.gaierror:
        return {"reachable": False, "responded": False,
                "detail": f"Could not resolve host '{host}'."}
    except OSError as exc:
        return {"reachable": False, "responded": False,
                "detail": f"Network error reaching {host}:{port}: {exc.strerror or exc}."}


@app.post("/api/connectivity/test")
def test_connectivity(payload: dict = Body(...), user=Depends(require_user)):
    """Probe a machine's configured endpoint and report what actually happened."""
    host = str(payload.get("host", "")).strip()
    if not host:
        raise HTTPException(status_code=400, detail="A host or IP address is required")

    try:
        port = int(payload.get("port") or 502)
        unit_id = int(payload.get("unit_id") or 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Port and unit id must be numbers")

    if not 1 <= port <= 65535:
        raise HTTPException(status_code=400, detail="Port must be between 1 and 65535")

    protocol = str(payload.get("protocol") or "modbus-tcp")
    if protocol not in ("modbus-tcp", "mqtt", "opc-ua"):
        return {
            "reachable": False, "responded": False,
            "detail": f"Live testing is not implemented for {protocol}.",
        }

    result = _modbus_probe(host, port, unit_id)
    result["protocol"] = protocol
    result["target"] = f"{host}:{port}"
    return result
