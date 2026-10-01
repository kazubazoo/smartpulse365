import math
import os
import re
import socket
import statistics
import struct
import time as _time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client import InfluxDBClient

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

# --------------------------------------------------------------------------
# InfluxDB 2.x
#
# The telemetry store is an InfluxDB 2.x server, which speaks Flux — not the
# SQL that InfluxDB 3 Core accepted. Three consequences shape every query
# below, and none of them is optional:
#
#   * `range()` is mandatory. There is no equivalent of an unbounded
#     `ORDER BY time DESC LIMIT 1`, so every route bounds itself, falling back
#     to MAX_LOOKBACK where the caller asked for "all of it".
#   * Results come back long — one row per field per timestamp — so every
#     query ends in `pivot()` to rebuild the wide rows the dashboard expects.
#   * There is no windowed STDDEV, no GREATEST and no CASE. Rolling statistics
#     and fault classification are therefore computed in Python here, which
#     also keeps the threshold values out of the query text entirely.
# --------------------------------------------------------------------------
INFLUX_URL = os.environ.get("INFLUX_URL", "http://influxdb:8086").rstrip("/")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "machine_telemetry")
MEASUREMENT = os.environ.get("INFLUX_MEASUREMENT", "motor_metrics")

# How far back a route reaches when the caller did not bound the window
# itself: the fleet roll-up's "latest reading per machine", a single /latest,
# and an unbounded fault table. Flux requires a range, so "everything" has to
# become a number somewhere.
MAX_LOOKBACK = os.environ.get("INFLUX_MAX_LOOKBACK", "7d")


# --------------------------------------------------------------------------
# Transport check
#
# The token authenticates every read, so sending it over plain HTTP to a host
# across the internet hands it to anyone on the path — and it keeps doing so at
# the dashboard's polling rate, not just once. Cleartext to a remote host is
# therefore refused rather than merely discouraged.
#
# A single-label hostname (`influxdb`, `localhost`) cannot be a public name: it
# is a container on the compose network or the loopback interface, so http is
# allowed there and local development needs no special case. Set
# INFLUX_ALLOW_INSECURE=true to override deliberately, which is a decision worth
# having to write down.
# --------------------------------------------------------------------------
def _transport_warning(url: str) -> Optional[str]:
    if url.startswith("https://"):
        return None
    host = url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    if host in {"localhost", "127.0.0.1", "::1"} or "." not in host:
        return None
    if os.environ.get("INFLUX_ALLOW_INSECURE", "").strip().lower() in {"1", "true", "yes"}:
        return None
    return (
        f"Refusing to send the InfluxDB token in cleartext to '{host}'. "
        "Use an https:// URL, or set INFLUX_ALLOW_INSECURE=true to override."
    )


INSECURE_TRANSPORT = _transport_warning(INFLUX_URL)

_influx = InfluxDBClient(
    url=INFLUX_URL,
    token=os.environ.get("INFLUX_TOKEN", ""),
    org=INFLUX_ORG,
    timeout=30_000,
    # Certificate verification stays on. Turning it off would accept any
    # certificate and so give away the token to an interceptor while still
    # looking encrypted.
    verify_ssl=True,
)
_query_api = _influx.query_api()


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


def _has_machine_tag() -> bool:
    """Whether the telemetry measurement identifies the asset yet.

    A single-motor deployment that has never written the tag has no such tag
    key, so every machine filter is suppressed in that case and all data is
    treated as belonging to the default machine.
    """
    if INSECURE_TRANSPORT:
        return False

    now = _time.time()
    if now - float(_schema_cache["checked_at"]) < 60:
        return bool(_schema_cache["has_machine_id"])

    flux = f'''
import "influxdata/influxdb/schema"
schema.measurementTagKeys(
    bucket: "{INFLUX_BUCKET}",
    measurement: "{MEASUREMENT}",
    start: -{MAX_LOOKBACK},
)
'''
    try:
        keys = {
            rec.get_value()
            for table in _query_api.query(flux, org=INFLUX_ORG)
            for rec in table.records
        }
        _schema_cache["has_machine_id"] = MACHINE_TAG in keys
    except Exception:
        _schema_cache["has_machine_id"] = False

    _schema_cache["checked_at"] = now
    return bool(_schema_cache["has_machine_id"])


def validate_machine(machine_id: str) -> str:
    if not MACHINE_ID_RE.match(machine_id):
        raise HTTPException(status_code=400, detail="Invalid machine id")
    return machine_id


def machine_filter(machine_id: str) -> str:
    """Flux filter restricting a stream to one machine.

    Rows written before the tag existed carry no identifying tag at all.
    InfluxDB matches a series missing a tag against the empty string, so `== ""`
    is how those untagged rows are attributed to the default machine rather than
    orphaned — the Flux equivalent of the old `machine_id IS NULL`.

    Returns an empty string when nothing has ever written the tag, since
    filtering on a tag key that does not exist would match nothing at all.
    """
    if not _has_machine_tag():
        return ""
    if machine_id == DEFAULT_MACHINE:
        return (f'  |> filter(fn: (r) => r["{MACHINE_TAG}"] == "{machine_id}" '
                f'or r["{MACHINE_TAG}"] == "")\n')
    return f'  |> filter(fn: (r) => r["{MACHINE_TAG}"] == "{machine_id}")\n'


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
    # Per-axis fault diagnosis codes from the sensor. Bucketed with MAX like
    # the vibration peaks, never averaged: the mean of code 0 and code 20 is
    # code 10, which is a different fault the sensor never reported. MAX keeps
    # any fault raised inside the bucket visible at coarse zoom.
    "fault_x", "fault_y", "fault_z",
]
AVG_FIELDS = [
    "vib_freq_x", "vib_freq_y", "vib_freq_z",
    "accel_x", "accel_y", "accel_z",
    "rpm", "voltage", "frequency", "speed_command_hz",
    "power", "current", "torque", "temperature", "sensor_chip_temp",
]
ALL_FIELDS = PEAK_FIELDS + AVG_FIELDS


# --------------------------------------------------------------------------
# Cloud schema translation
#
# The cloud bucket is filled by Novaflow's ingest from the MQTT payload that
# *Build MQTT Payload* publishes, so it carries the MQTT Publishing Guideline's
# schema rather than this dashboard's: guideline field names, and every value a
# **scaled integer** because the guideline types all measurements as INTEGER.
#
# Each entry below is `dashboard_field: (source_field, divisor)`, and the
# divisors are the same factors the flow multiplied by — the two tables have to
# be changed together. Getting one wrong is not a cosmetic bug: reading
# motor_VBR_VX's 124 as 124 mm/s instead of 1.24 mm/s puts a healthy motor three
# zones above its critical limit and alarms permanently.
#
# Dividing after aggregation is safe: scaling is linear, so it commutes with
# both MAX and MEAN.
# --------------------------------------------------------------------------
GUIDELINE_FIELDS = {
    "status_code":      ("motor_status", 1),
    "frequency":        ("motor_frequency", 100),
    "rpm":              ("motor_RPM", 10),
    "temperature":      ("motor_temperature", 1),
    "voltage":          ("motor_volt", 1),
    "current":          ("motor_amp", 100),
    "power":            ("motor_power", 10),
    "torque":           ("motor_torque", 10),
    "sensor_chip_temp": ("motor_VBR_chiptemp", 100),

    "vibration_x":      ("motor_VBR_VX", 100),
    "vibration_y":      ("motor_VBR_VY", 100),
    "vibration_z":      ("motor_VBR_VZ", 100),

    # Published in milli-g, because the guideline needs an integer and the
    # sensor's full scale is +/-16 g. Divided back to g here.
    "accel_x":          ("motor_VBR_AX", 1000),
    "accel_y":          ("motor_VBR_AY", 1000),
    "accel_z":          ("motor_VBR_AZ", 1000),

    # Already whole micrometres on the wire.
    "disp_x":           ("motor_VBR_DX", 1),
    "disp_y":           ("motor_VBR_DY", 1),
    "disp_z":           ("motor_VBR_DZ", 1),

    "vib_freq_x":       ("motor_VBR_FX", 10),
    "vib_freq_y":       ("motor_VBR_FY", 10),
    "vib_freq_z":       ("motor_VBR_FZ", 10),

    # Diagnosis codes, never scaled — and so never divided.
    "fault_x":          ("motor_VBR_faultX", 1),
    "fault_y":          ("motor_VBR_faultY", 1),
    "fault_z":          ("motor_VBR_faultZ", 1),

    # `speed_command_hz` is deliberately absent: the guideline payload has no
    # field for the VFD's commanded frequency, so it cannot be read from the
    # cloud at all. The Set Frequency panel renders an empty chart rather than
    # a fabricated trace, which is the honest result — adding the field to the
    # MQTT payload is what would fix it.
}

# "guideline" for the cloud bucket; "native" to read a store written directly
# by the flow's InfluxDB node, where the names and units are already correct.
GUIDELINE_SCHEMA = os.environ.get("INFLUX_SCHEMA", "guideline").lower() == "guideline"

# The guideline payload identifies the asset as `device_id` (and the flow sends
# "MOTOR001"), where the native schema tags rows `machine_id`. Whichever it is,
# rows come out of here keyed on `machine_id`, so nothing downstream has to care
# — but the id itself must still match the machine registry, or the join fails
# and the machine shows no data.
MACHINE_TAG = os.environ.get(
    "INFLUX_MACHINE_TAG", "device_id" if GUIDELINE_SCHEMA else "machine_id"
)

_SOURCE_OF = {name: src for name, (src, _) in GUIDELINE_FIELDS.items()}
_FROM_SOURCE = {src: (name, div) for name, (src, div) in GUIDELINE_FIELDS.items()}


def _source_limit(field: str, value: float) -> float:
    """Express a dashboard-unit limit in the units the bucket actually stores.

    A comparison pushed into Flux runs against the stored value, which under the
    guideline schema is scaled — so a 1.8 mm/s limit has to become 180 before it
    means anything there. Comparing the raw stored integer against 1.8 would
    flag every reading above 0.018 mm/s, i.e. all of them.
    """
    if not GUIDELINE_SCHEMA or field not in GUIDELINE_FIELDS:
        return value
    return value * GUIDELINE_FIELDS[field][1]


def _source_name(field: str) -> str:
    if not GUIDELINE_SCHEMA:
        return field
    return _SOURCE_OF.get(field, field)


def _source_fields(fields: list[str]) -> list[str]:
    """Translate dashboard field names into the names the bucket actually holds.

    A field with no counterpart in the guideline payload is dropped rather than
    passed through: asking for it would filter on a field key that does not
    exist, which quietly matches nothing.
    """
    if not GUIDELINE_SCHEMA:
        return fields
    return [_SOURCE_OF[f] for f in fields if f in _SOURCE_OF]


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


def _json_safe(value):
    """Turn NaN and infinities into None, which JSON can carry.

    SQL aggregates produce non-finite floats in ordinary situations: a windowed
    STDDEV over a single row is undefined, and on a perfectly flat signal — an
    idle motor reporting vibration of exactly 0.0 — the variance can land a
    hair below zero in floating point and come back NaN. `json.dumps` refuses
    both, so a machine that is merely stopped would 500 the whole endpoint.

    None is the honest answer: it means "not computable here", and the charts
    already render nulls as gaps rather than inventing a zero.
    """
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


# Flux bookkeeping columns. `_measurement` and the tag columns are dropped on
# the way out because the dashboard's row shape never carried them; machine_id
# is kept, since the fleet roll-up keys on it.
_DROP_COLUMNS = {"result", "table", "_start", "_stop", "_measurement"}


def _iso(stamp) -> str:
    """Render a Flux timestamp the way the dashboard expects to read it.

    `toEpoch()` in the frontend appends a `Z` to any timestamp that lacks one
    and hands the result to `new Date()`. A string carrying an explicit
    `+00:00` offset would become `...+00:00Z` — an invalid date, and NaN all
    the way into the charts. So the offset is normalised to a literal `Z`
    here rather than left to `isoformat()`'s default.

    Microsecond precision is kept deliberately: the acquisition flow writes
    several times per second, and the live tail de-duplicates rows by this
    exact string. Truncating to milliseconds would collide and drop readings.
    """
    if isinstance(stamp, datetime):
        return (stamp.astimezone(timezone.utc)
                     .isoformat(timespec="microseconds")
                     .replace("+00:00", "Z"))
    return str(stamp)


def _row(values: dict) -> dict:
    """Rebuild one dashboard row: rename, un-scale, normalise the timestamp."""
    out = {}
    for key, value in values.items():
        if key in _DROP_COLUMNS:
            continue
        if key == "_time":
            out["time"] = _iso(value)
            continue
        if key == MACHINE_TAG:
            out["machine_id"] = value
            continue

        name, divisor = _FROM_SOURCE.get(key, (key, 1)) if GUIDELINE_SCHEMA \
            else (key, 1)
        if divisor != 1 and isinstance(value, (int, float)) \
                and not isinstance(value, bool):
            value = value / divisor
        out[name] = _json_safe(value)
    return out


def run_flux(flux: str) -> list[dict]:
    """Execute a Flux query and return wide rows.

    A measurement that has never been written is an empty result in InfluxDB
    2.x rather than an error, so a fresh install renders an empty state with no
    special handling. A bucket or token that is wrong, by contrast, does raise
    — and is reported rather than swallowed, because a configuration mistake
    that silently returns no rows shows every machine as OFFLINE while live
    data is arriving.
    """
    if INSECURE_TRANSPORT:
        raise HTTPException(status_code=503, detail=INSECURE_TRANSPORT)
    try:
        tables = _query_api.query(flux, org=INFLUX_ORG)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Telemetry query failed: {exc}")
    return [_row(rec.values) for table in tables for rec in table.records]


def _field_filter(fields: list[str]) -> str:
    names = ", ".join(f'"{f}"' for f in _source_fields(fields))
    return f'  |> filter(fn: (r) => contains(value: r._field, set: [{names}]))\n'


def _stream(start: str, machine_id: Optional[str] = None,
            fields: Optional[list[str]] = None) -> str:
    """The opening of every query: bucket, range, measurement, machine, fields."""
    flux = (f'from(bucket: "{INFLUX_BUCKET}")\n'
            f'  |> range(start: {start})\n'
            f'  |> filter(fn: (r) => r._measurement == "{MEASUREMENT}")\n')
    if fields:
        flux += _field_filter(fields)
    if machine_id is not None:
        flux += machine_filter(machine_id)
    return flux


_PIVOT = '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n'


def _rolling_bounds(rows: list[dict], sigma: float, lookback: int) -> list[dict]:
    """Trailing mean and standard deviation of peak vibration, per row.

    InfluxDB 2.x has no windowed STDDEV, so the moving band that the old SQL
    computed with `STDDEV(...) OVER (ROWS BETWEEN n PRECEDING AND CURRENT ROW)`
    is computed here over the same trailing window.

    The first row of a window has a single sample, which makes the sample
    standard deviation undefined; an idle motor reporting a perfectly flat
    0.0 makes it zero. Both come back as a null bound rather than a number —
    the charts draw nulls as gaps, and inventing a band around a signal we
    cannot characterise would be fabricated confidence.
    """
    out = []
    peaks: list[float] = []
    for row in rows:
        peak = row.get("peak_vibration")
        entry = {"time": row["time"], "peak_vibration": peak,
                 "moving_avg": None, "upper_bound": None, "lower_bound": None}
        if peak is None:
            out.append(entry)
            continue

        peaks.append(peak)
        window = peaks[-(lookback + 1):]
        mean = statistics.fmean(window)
        entry["moving_avg"] = mean
        if len(window) >= 2:
            dev = statistics.stdev(window)
            entry["upper_bound"] = mean + dev * sigma
            entry["lower_bound"] = mean - dev * sigma
        out.append(entry)
    return [_json_safe(r) for r in out]


_VIB_AXES = ["vibration_x", "vibration_y", "vibration_z"]


def _peak_rows(rows: list[dict]) -> list[dict]:
    """Collapse the three vibration axes into the peak, as GREATEST() did.

    A row where no axis reported at all yields None, not 0.0 — a fabricated
    zero reads as "measured and still" when the truth is "not measured".
    """
    out = []
    for row in rows:
        values = [row[a] for a in _VIB_AXES if row.get(a) is not None]
        out.append({"time": row["time"],
                    "peak_vibration": max(values) if values else None})
    return out


@app.get("/api/health")
def service_health():
    return {
        "status": "ok",
        "auth_enabled": AUTH_ENABLED,
        # Surfaced so a deployment that cannot read telemetry says why, rather
        # than every machine simply appearing offline.
        "telemetry_blocked": INSECURE_TRANSPORT,
    }


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


def _count_exceedances(rows: list[dict], sigma: float, lookback: int,
                       floor: float) -> int:
    return sum(
        1 for r in _rolling_bounds(_peak_rows(rows), sigma, lookback)
        if r["peak_vibration"] is not None and r["upper_bound"] is not None
        and r["peak_vibration"] > r["upper_bound"]
        and r["peak_vibration"] > floor
    )


def _anomaly_counts(seconds: int, sigma: float, lookback: int, floor: float
                    ) -> dict[str, int]:
    """Anomalies per machine over the recent window, for the fleet cards.

    Reduced to one-second peaks before the trailing statistics are taken. The
    acquisition flow emits several rows per second, so a row-based lookback
    over raw rows would span only a fraction of the seconds the operator asked
    for, and the count would drift with the write rate rather than with the
    machine. One second per sample makes `lookback` mean what it reads like.
    """
    flux = _stream(f"-{seconds}s", fields=_VIB_AXES)
    flux += '  |> aggregateWindow(every: 1s, fn: max, createEmpty: false, timeSrc: "_start")\n'
    flux += _PIVOT
    flux += '  |> sort(columns: ["_time"])\n'

    try:
        rows = run_flux(flux)
    except HTTPException:
        return {}

    by_machine: dict[str, list[dict]] = {}
    for row in rows:
        by_machine.setdefault(row.get("machine_id") or DEFAULT_MACHINE, []).append(row)

    return {
        mid: _count_exceedances(machine_rows, sigma, lookback, floor)
        for mid, machine_rows in by_machine.items()
    }


def _parse_per_machine_limits(raw: str) -> dict[str, Thresholds]:
    """Per-machine alarm limits for the fleet roll-up.

    Each machine carries its own vibration standard, so scoring the whole fleet
    against one set of limits would rate a 2 kW fan and a 300 kW compressor on
    the same scale. The dashboard sends a compact map keyed by machine id; any
    machine missing from it falls back to the query-level thresholds, which is
    also what an older client that sends nothing at all gets.

    Format: `id:vib_warn:vib_critical:vib_scale:temp_warn:temp_critical`,
    comma separated. Kept positional rather than JSON so the URL stays short at
    fleet sizes and survives being logged.
    """
    out: dict[str, Thresholds] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        fields = part.split(":")
        if len(fields) != 6 or not MACHINE_ID_RE.match(fields[0]):
            continue
        try:
            values = [float(f) for f in fields[1:]]
        except ValueError:
            continue
        if not all(math.isfinite(v) for v in values):
            continue
        out[fields[0]] = Thresholds(*values)
    return out


@app.get("/api/machines")
def list_machines(
    ids: str = "",
    sigma: float = 3.0,
    lookback: int = 20,
    anomaly_floor: float = 0.5,
    limits: str = "",
    t: Thresholds = Depends(thresholds),
    user=Depends(require_user),
):
    """Fleet roll-up: every machine with its latest reading and recent anomalies.

    `ids` lets the dashboard supply the machine list it holds (machines are
    managed in the UI and stored in Supabase). Without it the MACHINES
    environment variable is used, so the API still works standalone.

    `limits` optionally carries each machine's own alarm limits — see
    `_parse_per_machine_limits`. Anything not listed uses the query defaults.
    """
    per_machine = _parse_per_machine_limits(limits)

    # `last()` is pushed down into storage, so this stays cheap however much
    # history the bucket holds — which is what the old ROW_NUMBER() window over
    # a seven-day scan was not.
    rows = run_flux(_stream(f"-{MAX_LOOKBACK}") + '  |> last()\n' + _PIVOT)

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

            health = compute_health(row, per_machine.get(mid, t))
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


def _latest_row(machine_id: str) -> dict:
    """The newest reading for one machine, as a single wide row.

    `last()` runs per field, so a field that stopped reporting earlier than the
    rest comes back carrying its own older timestamp and pivots into a second
    row. Only the newest row is returned: a value from minutes ago is not part
    of "the latest reading", and reporting it as such would age-launder stale
    data into a live gauge.
    """
    rows = run_flux(_stream(f"-{MAX_LOOKBACK}", machine_id) + '  |> last()\n' + _PIVOT)
    if not rows:
        return {}
    return max(rows, key=lambda r: r["time"])


@app.get("/api/machines/{machine_id}/latest")
def latest(machine_id: str, user=Depends(require_user)):
    validate_machine(machine_id)
    return _latest_row(machine_id)


@app.get("/api/machines/{machine_id}/history")
def history(machine_id: str, seconds: int = 300, max_points: int = 1500,
            user=Depends(require_user)):
    validate_machine(machine_id)
    seconds = max(1, min(seconds, 7 * 24 * 3600))
    bucket = _bucket_seconds(seconds, max_points)

    if bucket == 0:
        flux = (_stream(f"-{seconds}s", machine_id, ALL_FIELDS)
                + _PIVOT + '  |> sort(columns: ["_time"])\n')
    else:
        # The two field sets are aggregated differently and then unioned, which
        # is how the MAX-the-peaks / MEAN-the-rest asymmetry survives in Flux.
        # A transient impulse keeps its real amplitude at coarse zoom, and a
        # fault code is never averaged into a code the sensor never emitted.
        #
        # createEmpty: false leaves a window with no readings out of the result
        # entirely, so a gap in the telemetry stays a gap in the chart instead
        # of becoming a fabricated zero.
        #
        # timeSrc: "_start" stamps each window with its beginning, which is
        # what date_bin() did. The Flux default is the window's end, and taking
        # it would shift every point one bucket into the future.
        base = _stream(f"-{seconds}s", machine_id)
        peaks = (base + _field_filter(PEAK_FIELDS)
                 + f'  |> aggregateWindow(every: {bucket}s, fn: max, '
                   'createEmpty: false, timeSrc: "_start")\n')
        means = (base + _field_filter(AVG_FIELDS)
                 + f'  |> aggregateWindow(every: {bucket}s, fn: mean, '
                   'createEmpty: false, timeSrc: "_start")\n')
        flux = (f'peaks = {peaks}\nmeans = {means}\n'
                'union(tables: [peaks, means])\n'
                + _PIVOT + '  |> sort(columns: ["_time"])\n')

    return {"bucket_seconds": bucket, "rows": run_flux(flux)}


# The live tail's cursor is a timestamp this API emitted, echoed back. It is
# validated rather than escaped: it lands inside a Flux expression, and the only
# safe way to interpolate a caller-supplied value there is to prove it is a
# timestamp first.
RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$"
)


@app.get("/api/machines/{machine_id}/history/latest")
def history_latest(machine_id: str, since: str, user=Depends(require_user)):
    validate_machine(machine_id)
    if not RFC3339_RE.match(since):
        raise HTTPException(status_code=400,
                            detail="`since` must be an RFC 3339 timestamp")

    # range() is inclusive of its start, but the cursor is the newest row the
    # client already holds — so it is excluded explicitly to keep this a strict
    # delta rather than re-sending that row on every poll.
    flux = (_stream(since, machine_id, ALL_FIELDS)
            + f'  |> filter(fn: (r) => r._time > time(v: "{since}"))\n'
            + _PIVOT + '  |> sort(columns: ["_time"])\n')
    return run_flux(flux)


@app.get("/api/machines/{machine_id}/health")
def health(machine_id: str, t: Thresholds = Depends(thresholds),
           user=Depends(require_user)):
    validate_machine(machine_id)
    row = _latest_row(machine_id)
    return compute_health(row, t) if row else {}


@app.get("/api/machines/{machine_id}/anomalies")
def anomalies(machine_id: str, seconds: int = 300, sigma: float = 3.0,
              lookback: int = 20, max_points: int = 1500,
              user=Depends(require_user)):
    validate_machine(machine_id)
    seconds = max(1, min(seconds, 7 * 24 * 3600))
    sigma = max(0.1, min(sigma, 10.0))
    lookback = max(2, min(lookback, 500))
    bucket = _bucket_seconds(seconds, max_points)

    flux = _stream(f"-{seconds}s", machine_id, _VIB_AXES)
    if bucket:
        flux += (f'  |> aggregateWindow(every: {bucket}s, fn: max, '
                 'createEmpty: false, timeSrc: "_start")\n')
    flux += _PIVOT + '  |> sort(columns: ["_time"])\n'

    return _rolling_bounds(_peak_rows(run_flux(flux)), sigma, lookback)


@app.get("/api/machines/{machine_id}/root-cause-history")
def root_cause_history(machine_id: str, limit: int = 10, seconds: int = 0,
                       t: Thresholds = Depends(thresholds),
                       user=Depends(require_user)):
    validate_machine(machine_id)
    limit = max(1, min(limit, 500))
    warn, crit, tw, tc = t.vib_warn, t.vib_critical, t.temp_warn, t.temp_critical
    for value in (warn, crit, tw, tc):
        if not math.isfinite(value):
            raise HTTPException(status_code=400, detail="Thresholds must be finite")

    # Unbounded in the old SQL; Flux requires a range, so "all of it" becomes
    # MAX_LOOKBACK. Faults older than that are not reachable from this route.
    start = f"-{min(seconds, 7 * 24 * 3600)}s" if seconds > 0 else f"-{MAX_LOOKBACK}"

    # The exceedance test runs server-side so only the handful of rows that
    # actually tripped a limit cross the network — a seven-day window is far too
    # much to pull back and sift here. That means comparing against the *stored*
    # column names and the *stored* scale, which is what _source_name and
    # _source_limit supply; the values are cast to float first because Flux
    # refuses to compare an integer column against a float literal.
    #
    # Classification stays in Python, on the un-scaled values: Flux has no CASE,
    # and this keeps one copy of the cascade rather than a second one in Flux
    # that could drift away from it.
    vx_s, vy_s, vz_s = (_source_name(a) for a in _VIB_AXES)
    temp_s = _source_name("temperature")
    vib_limit = _source_limit("vibration_x", warn)
    temp_limit = _source_limit("temperature", tw)

    flux = (_stream(start, machine_id, _VIB_AXES + ["temperature"])
            + '  |> map(fn: (r) => ({ r with _value: float(v: r._value) }))\n'
            + _PIVOT
            + f'  |> filter(fn: (r) => r["{vx_s}"] > {float(vib_limit)!r} '
              f'or r["{vy_s}"] > {float(vib_limit)!r} '
              f'or r["{vz_s}"] > {float(vib_limit)!r} '
              f'or r["{temp_s}"] > {float(temp_limit)!r})\n'
            + '  |> sort(columns: ["_time"], desc: true)\n'
            + f'  |> limit(n: {limit})\n')

    out = []
    for row in run_flux(flux):
        vx = row.get("vibration_x") or 0
        vy = row.get("vibration_y") or 0
        vz = row.get("vibration_z") or 0
        temp = row.get("temperature") or 0

        if temp > tc:
            fault = "Thermal Overload"
        elif vz > warn:
            fault = "Axial Misalignment"
        elif vy > warn:
            fault = "Vertical Looseness"
        elif vx > warn:
            fault = "Horizontal Unbalance"
        elif temp > tw:
            fault = "Elevated Temperature"
        else:
            fault = None

        if temp > tc:
            urgency = "Immediate shutdown: high risk of fire or winding failure."
        elif vz > crit:
            urgency = "CRITICAL: vibration is damaging the motor (Zone D)."
        elif vz > warn:
            urgency = "Urgent: bearings and couplings under stress (Zone C)."
        elif vy > warn:
            urgency = "Caution: foundation bolts are loose; inspect mounting."
        elif vx > warn:
            urgency = "Maintenance: schedule a cleaning or balancing."
        elif temp > tw:
            urgency = "Monitor: running warmer than the configured normal band."
        else:
            urgency = None

        # The server-side pre-filter works on scaled integers and so rounds a
        # hair wider than the exact limits; a row that squeezes through it but
        # exceeds nothing classifies to None. Those are dropped rather than
        # listed as a fault with no name.
        if fault is None:
            continue

        out.append({"time": row["time"], "fault_type": fault, "urgency": urgency})
    return out


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
