// Every tunable the dashboard exposes, split by what it actually belongs to.
//
// Display preferences are per operator and live in Supabase `user_settings`.
// Analytic configuration is per machine and lives in `machines.thresholds` —
// alarm limits are a property of the equipment, not of who is looking at it.
// Both are still sent to the API as query parameters on each request, so the
// backend remains stateless and stores none of this.

import { resolveLimits } from './standards'

export const TIME_RANGES = [
  { id: '1m', label: 'Last 1 minute', seconds: 60 },
  { id: '5m', label: 'Last 5 minutes', seconds: 300 },
  { id: '15m', label: 'Last 15 minutes', seconds: 900 },
  { id: '30m', label: 'Last 30 minutes', seconds: 1800 },
  { id: '1h', label: 'Last 1 hour', seconds: 3600 },
  { id: '3h', label: 'Last 3 hours', seconds: 10800 },
  { id: '6h', label: 'Last 6 hours', seconds: 21600 },
  { id: '12h', label: 'Last 12 hours', seconds: 43200 },
  { id: '24h', label: 'Last 24 hours', seconds: 86400 },
  { id: '7d', label: 'Last 7 days', seconds: 604800 },
]

export const REFRESH_INTERVALS = [
  { id: 'off', label: 'Off', ms: 0 },
  { id: '1s', label: '1s', ms: 1000 },
  { id: '5s', label: '5s', ms: 5000 },
  { id: '10s', label: '10s', ms: 10000 },
  { id: '30s', label: '30s', ms: 30000 },
  { id: '1m', label: '1m', ms: 60000 },
]

// Idle timeout choices. A plant terminal left unattended is a real risk, but an
// operator watching a trend must not be thrown out mid-shift, so 30 minutes is
// the usual industrial compromise — short enough that a walk-away is covered,
// long enough that nobody is fighting the login screen.
export const IDLE_TIMEOUTS = [
  { id: '15', label: '15 minutes', minutes: 15 },
  { id: '30', label: '30 minutes', minutes: 30 },
  { id: '60', label: '1 hour', minutes: 60 },
  { id: '240', label: '4 hours', minutes: 240 },
  { id: 'off', label: 'Never', minutes: 0 },
]

// Above this window length the client stops tailing with 1 Hz delta fetches and
// switches to periodic full refetches of server-downsampled data.
export const LIVE_TAIL_MAX_SECONDS = 900

// --------------------------------------------------------------------------
// Per-operator display preferences
// --------------------------------------------------------------------------
export const DEFAULT_UI_SETTINGS = {
  rangeId: '5m',
  refreshId: '1s',

  // Chart resolution — the point budget requested from the API per window.
  maxPoints: 1500,

  rootCauseLimit: 10,
  rootCauseWindowed: true,  // confine fault history to the selected range

  idleTimeoutId: '30',
}

// --------------------------------------------------------------------------
// Per-machine analytic configuration
//
// The vibration limits are derived from the selected standard rather than
// stored, so they can never drift out of step with the class. Only `custom`
// keeps its own numbers.
// --------------------------------------------------------------------------
export const DEFAULT_MACHINE_CONFIG = {
  // ISO 10816-1 Class I gives 1.8 / 4.5 mm/s — the limits this dashboard
  // shipped with, so an unconfigured machine behaves exactly as before.
  standardId: 'iso-10816-1',
  classId: 'class-1',

  // Nameplate details, used to suggest the class and to document the choice.
  powerKw: '',
  shaftHeightMm: '',
  mounting: 'rigid',

  // Only consulted when standardId === 'custom'.
  vibWarn: 1.8,
  vibCritical: 4.5,
  vibScale: 4.5,

  tempWarn: 50,
  tempCritical: 60,

  // Anomaly detector. Tuning follows the machine's own noise characteristics.
  sigma: 3.0,          // band width in standard deviations
  lookback: 20,        // samples in the rolling window
  anomalyFloor: 0.5,   // ignore excursions below this absolute value

  // Gauge full-scale values — nameplate ratings, so the arcs read meaningfully.
  gauges: {
    voltage: 500,
    current: 15,
    torque: 100,
    power: 50,
    frequency: 60,
    temperature: 80,
  },
}

/** Fill in anything a stored machine config is missing. */
export function withMachineDefaults(stored) {
  if (!stored || typeof stored !== 'object') return DEFAULT_MACHINE_CONFIG
  return {
    ...DEFAULT_MACHINE_CONFIG,
    ...stored,
    gauges: { ...DEFAULT_MACHINE_CONFIG.gauges, ...(stored.gauges ?? {}) },
  }
}

/** Exactly the fields that get persisted, in a fixed key order.
 *
 * `resolveLimits` adds derived fields (`zoneAB`, `source`) on top of a config
 * for display. Those must never reach the database: they are recomputed from
 * the standard on every read, so storing them would let a stale copy outlive a
 * change to the table — and, more immediately, they made the settings form
 * think it had unsaved work forever. Postgres `jsonb` does not preserve key
 * order, so a saved object comes back with its keys rearranged; comparing the
 * round-tripped value against the draft then reported a difference that was
 * only ever a difference in key order.
 */
export function pickMachineConfig(config) {
  const full = withMachineDefaults(config)
  const out = {}
  for (const key of Object.keys(DEFAULT_MACHINE_CONFIG)) out[key] = full[key]
  out.gauges = { ...full.gauges }
  return out
}

/** Order-independent serialization, for comparing a draft with what is stored. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/** Machine config with the standard's limits folded in, ready to send.
 *
 * For reading and for API calls only — never write the result back.
 */
export function effectiveMachineConfig(stored) {
  const config = withMachineDefaults(stored)
  const limits = resolveLimits(config)
  return limits ? { ...config, ...limits } : config
}

// --------------------------------------------------------------------------
// Migration from the single flat blob the dashboard used to store
// --------------------------------------------------------------------------
const MACHINE_KEYS = [
  'vibWarn', 'vibCritical', 'vibScale', 'tempWarn', 'tempCritical',
  'sigma', 'lookback', 'anomalyFloor', 'gauges',
  'standardId', 'classId', 'powerKw', 'shaftHeightMm', 'mounting',
]

/** Split a legacy settings blob into its display and machine halves.
 *
 * The old shape held both in one object. The machine half becomes the fallback
 * applied to any machine that has no configuration of its own, so an operator's
 * existing tuning survives the split instead of snapping back to defaults.
 */
export function splitLegacySettings(blob) {
  const ui = { ...DEFAULT_UI_SETTINGS }
  const machine = {}
  if (!blob || typeof blob !== 'object') {
    return { ui, machine: null }
  }

  for (const [key, value] of Object.entries(blob)) {
    if (MACHINE_KEYS.includes(key)) machine[key] = value
    else if (key in DEFAULT_UI_SETTINGS) ui[key] = value
  }

  // A legacy blob predates the standards picker, so its numbers are hand-set
  // by definition — keep them by marking the machine custom.
  if (Object.keys(machine).length > 0 && !machine.standardId) {
    machine.standardId = 'custom'
  }

  return { ui, machine: Object.keys(machine).length ? machine : null }
}

export function rangeSeconds(rangeId) {
  return (TIME_RANGES.find(r => r.id === rangeId) ?? TIME_RANGES[1]).seconds
}

export function refreshMs(refreshId) {
  return (REFRESH_INTERVALS.find(r => r.id === refreshId) ?? REFRESH_INTERVALS[1]).ms
}

export function idleTimeoutMs(idleTimeoutId) {
  const entry = IDLE_TIMEOUTS.find(t => t.id === idleTimeoutId) ?? IDLE_TIMEOUTS[1]
  return entry.minutes * 60 * 1000
}

// Analytic parameters shared by /health, /anomalies and /root-cause-history.
export function thresholdParams(config) {
  const c = effectiveMachineConfig(config)
  return {
    vib_warn: c.vibWarn,
    vib_critical: c.vibCritical,
    vib_scale: c.vibScale,
    temp_warn: c.tempWarn,
    temp_critical: c.tempCritical,
  }
}

export function toQuery(params) {
  return new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString()
}
