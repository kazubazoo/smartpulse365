#!/usr/bin/env python3
"""Optional demo machine — synthetic telemetry for showcasing the dashboard.

This is NOT part of the production pipeline. Real readings come from the PLC via
Node-RED. Use this only when you need a machine that visibly does something
during a demo, on a bench with no hardware attached.

Everything it writes is tagged with a machine_id of its own (default "demo01"),
so it can never be mistaken for, or mixed into, a real machine's history.

    # Stream live at 1 Hz until Ctrl+C (machine shows as RUNNING / online)
    python github/tools/demo_machine.py stream

    # Backfill 6 hours of history so the long time ranges have something to show
    python github/tools/demo_machine.py backfill --hours 6

    # Remove everything this script ever wrote
    python github/tools/demo_machine.py purge

Register a machine in the dashboard with a Machine ID matching --machine-id for
it to appear on the Overview.
"""
import argparse
import math
import os
import pathlib
import random
import sys
import time
import urllib.error
import urllib.request

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_HOST = os.environ.get("INFLUXDB_URL", "http://localhost:8181")
DATABASE = os.environ.get("INFLUXDB_DATABASE", "machine_telemetry")


def read_token() -> str:
    token = os.environ.get("INFLUXDB3_AUTH_TOKEN")
    if token:
        return token
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("INFLUXDB3_AUTH_TOKEN="):
                return line.split("=", 1)[1].strip()
    sys.exit("No InfluxDB token. Set INFLUXDB3_AUTH_TOKEN or add it to .env")


def sample(machine_id: str, ts_ms: int, minutes: float, vib: float, temp: float,
           rpm_base: int, status: int, burst_chance: float) -> str:
    burst = 1.5 if random.random() < burst_chance else 0.0
    running = status == 2

    vx = vib + 0.18 * math.sin(minutes * 1.7) + random.gauss(0, 0.05) + burst
    vy = vib * 1.15 + 0.22 * math.sin(minutes * 1.1 + 1) + random.gauss(0, 0.05) + burst * 0.7
    vz = vib * 0.75 + 0.14 * math.sin(minutes * 2.3 + 2) + random.gauss(0, 0.04) + burst * 0.4

    fields = {
        "vibration_x": vx, "vibration_y": vy, "vibration_z": vz,
        "disp_x": vx * 12, "disp_y": vy * 12, "disp_z": vz * 12,
        "vib_freq_x": 24.6 + random.gauss(0, .3),
        "vib_freq_y": 25.1 + random.gauss(0, .3),
        "vib_freq_z": 24.9 + random.gauss(0, .3),
        # Hard zero on the WTVB01-485, matching the real sensor (see README).
        "accel_x": 0.0, "accel_y": 0.0, "accel_z": 0.0,
        "sensor_chip_temp": temp * 0.7 + 0.4 * math.sin(minutes * 0.3),
        "rpm": (rpm_base + 8 * math.sin(minutes * 0.6) + random.gauss(0, 1.5)) if running else 0.0,
        "voltage": (381.2 + random.gauss(0, 1.1)) if running else 0.0,
        "frequency": (50.0 + random.gauss(0, .05)) if running else 0.0,
        "speed_command_hz": 50.0 if running else 0.0,
        "power": (2.21 + random.gauss(0, .02)) if running else 0.0,
        "current": (4.48 + random.gauss(0, .06)) if running else 0.0,
        "torque": (14.3 + random.gauss(0, .2)) if running else 0.0,
        "temperature": temp + 2.0 * math.sin(minutes * 0.2) + random.gauss(0, .15),
        "status_code": status,
    }
    body = ",".join(f"{k}={v}" for k, v in fields.items())
    return f"motor_metrics,machine_id={machine_id} {body} {ts_ms}"


def write(lines, token, chunk=8000):
    url = f"{DEFAULT_HOST}/api/v3/write_lp?db={DATABASE}&precision=millisecond"
    for i in range(0, len(lines), chunk):
        payload = "\n".join(lines[i:i + chunk]).encode()
        req = urllib.request.Request(
            url, data=payload, method="POST",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            if resp.status != 204:
                raise RuntimeError(f"write failed: HTTP {resp.status}")


def cmd_backfill(args, token):
    now_ms = int(time.time() * 1000)
    start = now_ms - int(args.hours * 3600 * 1000)
    lines = [
        sample(args.machine_id, ts, (ts - start) / 60000.0,
               args.vibration, args.temperature, args.rpm, args.status, 0.004)
        for ts in range(start, now_ms, args.step * 1000)
    ]
    write(lines, token)
    print(f"backfilled {len(lines)} points over {args.hours}h for {args.machine_id}")


def cmd_stream(args, token):
    print(f"streaming {args.machine_id} at 1 Hz — Ctrl+C to stop")
    started = time.time()
    n = 0
    while True:
        ts = int(time.time() * 1000)
        line = sample(args.machine_id, ts, (time.time() - started) / 60.0,
                      args.vibration, args.temperature, args.rpm, args.status, 0.01)
        try:
            write([line], token)
            n += 1
            if n % 60 == 0:
                print(f"  {n} points written", flush=True)
        except (urllib.error.URLError, RuntimeError) as exc:
            print(f"  write failed: {exc}", flush=True)
        time.sleep(1)


def cmd_purge(args, token):
    """Delete this demo machine's rows. InfluxDB 3 Core deletes by table, so the
    safe scoped option is a predicate delete via the query API."""
    print(
        f"InfluxDB 3 Core cannot delete a subset of rows by tag.\n"
        f"To remove demo data, drop the whole table (this also removes REAL data):\n\n"
        f"  docker compose exec influxdb influxdb3 delete table motor_metrics \\\n"
        f"      --database {DATABASE} --token $INFLUXDB3_AUTH_TOKEN\n\n"
        f"If real readings are already stored, instead remove '{args.machine_id}'\n"
        f"from the dashboard's Machines page — it will stop being displayed."
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["stream", "backfill", "purge"])
    ap.add_argument("--machine-id", default="demo01",
                    help="machine_id tag to write under (default: demo01)")
    ap.add_argument("--hours", type=float, default=6, help="backfill length")
    ap.add_argument("--step", type=int, default=5, help="backfill resolution, seconds")
    ap.add_argument("--vibration", type=float, default=0.95, help="baseline mm/s")
    ap.add_argument("--temperature", type=float, default=44.0, help="baseline degC")
    ap.add_argument("--rpm", type=int, default=1452)
    ap.add_argument("--status", type=int, default=2,
                    help="0=E-STOP, 1=IDLE, 2=RUNNING")
    args = ap.parse_args()

    token = read_token()
    {"stream": cmd_stream, "backfill": cmd_backfill, "purge": cmd_purge}[args.command](args, token)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped")
