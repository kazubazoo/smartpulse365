import { memo } from 'react'

// A half-circle gauge for one live reading.
//
// `value` may be null, and is rendered as "—" with an empty arc. A missing
// reading used to be passed in as 0, which drew a confident "0 V" that looked
// exactly like a real measurement of a dead supply. On a diagnostic tool that
// is worse than showing nothing: it hides the gap.
function GaugeCard({ label, value, unit, max, min = 0, color = '#38BDF8', decimals = 0 }) {
  const known = value !== null && value !== undefined && Number.isFinite(value)
  const clamped = known ? Math.max(min, Math.min(max, value)) : min
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col items-center">
      <span className="font-body text-xs tracking-widest uppercase text-slate-100 mb-1 self-start">{label}</span>
      <svg viewBox="0 0 120 68" className="w-full max-w-[170px] mt-1" aria-hidden="true">
        <path
          d="M10 60 A50 50 0 0 1 110 60"
          fill="none" stroke="#1B3A5C" strokeWidth="10" strokeLinecap="round" pathLength="100"
        />
        {known && (
          <path
            d="M10 60 A50 50 0 0 1 110 60"
            fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            pathLength="100" strokeDasharray="100" strokeDashoffset={100 - pct}
            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
          />
        )}
      </svg>
      <div className="font-display text-2xl -mt-7" style={{ color: known ? color : '#64748B' }}>
        {known ? value.toFixed(decimals) : '—'}
        {known && <span className="text-sm text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

export default memo(GaugeCard)
