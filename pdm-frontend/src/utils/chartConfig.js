// Module scope = created once, stable identity across renders.
// Inline object literals in JSX defeat Recharts' internal memoization.
export const GRID = { stroke: '#1B3A5C', strokeDasharray: '3 3' }
export const AXIS_TICK = { fontSize: 11 }
export const TOOLTIP_CONTENT = { background: '#0E1B2E', border: '1px solid #1B3A5C', borderRadius: 8 }
export const TOOLTIP_LABEL = { color: '#94A3B8' }
export const LEGEND_WRAPPER = { fontSize: 11, color: '#94A3B8' }
export const AXIS_STROKE = '#64748B'

// Each bucket contributes its actual minimum and maximum rows, so transient
// spikes survive intact (important for bearing-defect impulses).
export function decimate(rows, targetPoints, valueKey) {
  if (rows.length <= targetPoints) return rows
  const bucketSize = Math.ceil(rows.length / (targetPoints / 2))
  const out = []
  for (let i = 0; i < rows.length; i += bucketSize) {
    const end = Math.min(i + bucketSize, rows.length)
    let min = rows[i], max = rows[i]
    for (let j = i; j < end; j++) {
      if (rows[j][valueKey] < min[valueKey]) min = rows[j]
      if (rows[j][valueKey] > max[valueKey]) max = rows[j]
    }
    if (min === max) out.push(min)
    else if (min.t <= max.t) { out.push(min); out.push(max) }
    else { out.push(max); out.push(min) }
  }
  return out
}