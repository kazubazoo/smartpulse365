export function toEpoch(rawTime) {
  const utcString = rawTime.endsWith('Z') ? rawTime : rawTime + 'Z'
  return new Date(utcString).getTime()
}

// ONE formatter instance, reused. Constructing Intl.DateTimeFormat per call
// was allocating ~12,000 objects per render.
const labelFormatter = new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function toLabel(epochMs) {
  return labelFormatter.format(epochMs)
}

// Normalize once at ingest — never during render.
export function normalizeRow(r) {
  const t = toEpoch(r.time)
  return { ...r, t, label: toLabel(t) }
}
// Reused formatter instances, one per scale. Constructing Intl.DateTimeFormat
// inside a tick callback would allocate one per tick, per render.
const TZ = 'Asia/Kuala_Lumpur'
const timeOnly = new Intl.DateTimeFormat('en-MY', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit',
})
const dayAndTime = new Intl.DateTimeFormat('en-MY', {
  timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
})
const dayOnly = new Intl.DateTimeFormat('en-MY', {
  timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short',
})

// Tick labels have to change with the window: seconds are noise across a week,
// and a bare clock time is ambiguous once the range spans more than one day.
export function axisFormatter(windowSeconds) {
  if (windowSeconds > 3 * 24 * 3600) return (t) => dayOnly.format(t)
  if (windowSeconds > 12 * 3600) return (t) => dayAndTime.format(t)
  if (windowSeconds > 6 * 3600) return (t) => timeOnly.format(t)
  return (t) => labelFormatter.format(t)
}

// Tooltips always carry the full date, whatever the axis shows.
export function tooltipFormatter(t) {
  return dayAndTime.format(t)
}

// Recharts' own tick generation produced nothing for an explicit epoch-ms
// domain, so the ticks are computed here: evenly spaced across the selected
// window, which also guarantees the axis spans the full range even when the
// data covers only part of it.
export function timeTicks(from, to, count = 6) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const step = (to - from) / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round(from + step * i))
}
