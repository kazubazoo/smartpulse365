// Every tunable the dashboard exposes, in one place. The Settings page edits
// this shape, it is persisted per user in Supabase, and the analytic values are
// passed to the API on each request — the backend stores none of it.

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

// Above this window length the client stops tailing with 1 Hz delta fetches and
// switches to periodic full refetches of server-downsampled data.
export const LIVE_TAIL_MAX_SECONDS = 900

export const DEFAULT_SETTINGS = {
  rangeId: '5m',
  refreshId: '1s',

  // ISO 10816-3 zone boundaries for a small rigidly-mounted machine.
  vibWarn: 1.8,        // Zone B -> C, raises a fault row
  vibCritical: 4.5,    // Zone C -> D, damaging
  vibScale: 4.5,       // peak vibration that maps to a health score of 0

  tempWarn: 50,
  tempCritical: 60,

  // Anomaly detector
  sigma: 3.0,          // band width in standard deviations
  lookback: 20,        // samples in the rolling window
  anomalyFloor: 0.5,   // ignore excursions below this absolute value

  // Chart resolution — the point budget requested from the API per window.
  maxPoints: 1500,

  rootCauseLimit: 10,
  rootCauseWindowed: true,  // confine fault history to the selected range

  // Overview gauge full-scale values, so the arcs suit the actual machine.
  gauges: {
    voltage: 500,
    current: 15,
    torque: 100,
    power: 50,
    frequency: 60,
    temperature: 80,
  },
}

export function rangeSeconds(rangeId) {
  return (TIME_RANGES.find(r => r.id === rangeId) ?? TIME_RANGES[1]).seconds
}

export function refreshMs(refreshId) {
  return (REFRESH_INTERVALS.find(r => r.id === refreshId) ?? REFRESH_INTERVALS[1]).ms
}

// Analytic parameters shared by /health, /anomalies and /root-cause-history.
export function thresholdParams(s) {
  return {
    vib_warn: s.vibWarn,
    vib_critical: s.vibCritical,
    vib_scale: s.vibScale,
    temp_warn: s.tempWarn,
    temp_critical: s.tempCritical,
  }
}

export function toQuery(params) {
  return new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString()
}
