// One vocabulary for machine state and health, shared by every page that shows
// either. The same machine used to read IDLE on the Overview and STOPPED on
// Diagnostics; keeping the words and colours here makes that impossible.

// What the machine is doing. The backend decides this (`run_state` on
// /api/machines); runStateFor mirrors `_run_state()` in pdm-backend/main.py so
// the Diagnostics header, which polls faster, can derive it from status_code.
export const RUN_STATE_COLOR = {
  RUNNING: '#34D399',
  IDLE: '#38BDF8',
  'E-STOP': '#F87171',
  OFFLINE: '#64748B',
  UNKNOWN: '#64748B',
}

// OFFLINE means nothing is arriving; IDLE means data is arriving and the motor
// is simply stopped. Keeping them apart stops a dead sensor from looking like a
// machine that was deliberately switched off.
export function runStateFor(online, statusCode) {
  if (!online) return 'OFFLINE'
  return { 0: 'E-STOP', 1: 'IDLE', 2: 'RUNNING' }[statusCode] ?? 'UNKNOWN'
}

// How healthy the latest reading is, from `compute_health()` in main.py.
export const SEVERITY_COLOR = {
  ok: '#34D399',
  idle: '#38BDF8',
  watch: '#FBBF24',
  warning: '#FB923C',
  critical: '#F87171',
  unknown: '#64748B',
}

export function severityColor(severity) {
  return SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.unknown
}

// Whether a machine belongs in the Overview's "needing attention" count. A
// stopped motor is a normal state, not an alarm. Missing vibration data is
// counted: a running motor whose sensor has gone quiet is exactly what someone
// should look at.
export function needsAttention(severity) {
  return ['watch', 'warning', 'critical', 'unknown'].includes(severity)
}
