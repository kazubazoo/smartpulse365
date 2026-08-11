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