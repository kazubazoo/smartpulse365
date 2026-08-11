from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from influxdb_client_3 import InfluxDBClient3
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = InfluxDBClient3(
    host="http://influxdb:8181",
    token=os.environ.get("INFLUXDB3_AUTH_TOKEN"),
    database="machine_telemetry",
)

FIELDS = """
    time, vibration_x, vibration_y, vibration_z,
    disp_x, disp_y, disp_z,
    vib_freq_x, vib_freq_y, vib_freq_z,
    accel_x, accel_y, accel_z,
    rpm, voltage, frequency, speed_command_hz, power, current, torque
"""

@app.get("/api/machines/motor01/latest")
def latest():
    query = 'SELECT * FROM "motor_metrics" ORDER BY time DESC LIMIT 1'
    table = client.query(query=query, language="sql")
    rows = table.to_pylist()
    return rows[0] if rows else {}

@app.get("/api/machines/motor01/history")
def history(minutes: int = 5):
    query = f"""
        SELECT {FIELDS}
        FROM "motor_metrics"
        WHERE time >= now() - INTERVAL '{minutes} minutes'
        ORDER BY time ASC
    """
    table = client.query(query=query, language="sql")
    return table.to_pylist()

@app.get("/api/machines/motor01/history/latest")
def history_latest(since: str):
    query = f"""
        SELECT {FIELDS}
        FROM "motor_metrics"
        WHERE time > CAST('{since}' AS TIMESTAMP)
        ORDER BY time ASC
    """
    table = client.query(query=query, language="sql")
    return table.to_pylist()


def compute_health(row):
    vx, vy, vz = row.get("vibration_x", 0), row.get("vibration_y", 0), row.get("vibration_z", 0)
    temp = row.get("temperature", 0)
    peak = max(vx, vy, vz)
    health_percent = max(0, round(100 - (peak / 4.5 * 100)))

    if temp > 60:
        status_label = "CRITICAL: OVERHEAT"
    elif vz > 1.8:
        status_label = "ALARM: Axial Misalignment"
    elif vx > 1.8 or vy > 1.8:
        status_label = "WARNING: Radial Unbalance/Looseness"
    else:
        status_label = "SYSTEM OPTIMAL"

    if vy > 2.8 and vy > vx:
        commentary = "Vertical looseness detected. High Y-axis energy suggests loose mounting bolts or a soft-foot condition."
    elif temp > 60:
        commentary = "Thermal overload detected. High risk of bearing lubricant breakdown. Check the cooling fan."
    elif vz > vx and vz > vy and vz > 2.8:
        commentary = "Axial vibration is dominant, suggesting coupling misalignment or thrust bearing wear."
    elif vx > 2.8 or vy > 2.8:
        commentary = "Radial vibration detected. Likely cause: rotor unbalance or loose mounting bolts."
    else:
        commentary = "Vibration signatures are harmonized. Motor is within ISO 10816-3 Zone A (Optimal)."

    return {"health_percent": health_percent, "status_label": status_label, "ai_commentary": commentary}

@app.get("/api/machines/motor01/health")
def health():
    query = 'SELECT * FROM "motor_metrics" ORDER BY time DESC LIMIT 1'
    table = client.query(query=query, language="sql")
    rows = table.to_pylist()
    return compute_health(rows[0]) if rows else {}

@app.get("/api/machines/motor01/anomalies")
def anomalies(minutes: int = 5):
    query = f"""
        SELECT time, peak_vibration,
               moving_avg + (std_dev * 3) AS upper_bound,
               moving_avg - (std_dev * 3) AS lower_bound,
               moving_avg
        FROM (
            SELECT time,
                   GREATEST(vibration_x, vibration_y, vibration_z) as peak_vibration,
                   AVG(GREATEST(vibration_x, vibration_y, vibration_z))
                       OVER(ORDER BY time ROWS BETWEEN 20 PRECEDING AND CURRENT ROW) as moving_avg,
                   STDDEV(GREATEST(vibration_x, vibration_y, vibration_z))
                       OVER(ORDER BY time ROWS BETWEEN 20 PRECEDING AND CURRENT ROW) as std_dev
            FROM "motor_metrics"
            WHERE time >= now() - INTERVAL '{minutes} minutes'
        ) AS stats
        ORDER BY time ASC
    """
    table = client.query(query=query, language="sql")
    return table.to_pylist()

@app.get("/api/machines/motor01/root-cause-history")
def root_cause_history(limit: int = 10):
    query = f"""
        SELECT time,
            CASE
                WHEN temperature > 60 THEN 'Thermal Overload'
                WHEN vibration_z > 1.8 THEN 'Axial Misalignment'
                WHEN vibration_y > 1.8 THEN 'Vertical Looseness'
                WHEN vibration_x > 1.8 THEN 'Horizontal Unbalance'
            END AS fault_type,
            CASE
                WHEN temperature > 60 THEN 'Immediate shutdown: high risk of fire or winding failure.'
                WHEN vibration_z > 4.5 THEN 'CRITICAL: vibration is damaging the motor (Zone D).'
                WHEN vibration_z > 1.8 THEN 'Urgent: bearings and couplings under stress (Zone C).'
                WHEN vibration_y > 1.8 THEN 'Caution: foundation bolts are loose; inspect mounting.'
                WHEN vibration_x > 1.8 THEN 'Maintenance: schedule a cleaning or balancing.'
            END AS urgency
        FROM "motor_metrics"
        WHERE vibration_x > 1.8 OR vibration_y > 1.8 OR vibration_z > 1.8 OR temperature > 60
        ORDER BY time DESC
        LIMIT {limit}
    """
    table = client.query(query=query, language="sql")
    return table.to_pylist()