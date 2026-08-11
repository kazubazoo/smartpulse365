function GaugeCard({ label, value, unit, max, min = 0, color = '#38BDF8', decimals = 0 }) {
  const clamped = Math.max(min, Math.min(max, value))
  const pct = ((clamped - min) / (max - min)) * 100

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col items-center">
      <span className="font-body text-xs tracking-widest uppercase text-slate-400 mb-1 self-start">{label}</span>
      <svg viewBox="0 0 120 68" className="w-full max-w-[170px] mt-1">
        {/* Background track */}
        <path
          d="M10 60 A50 50 0 0 1 110 60"
          fill="none" stroke="#1B3A5C" strokeWidth="10" strokeLinecap="round" pathLength="100"
        />
        {/* Value arc */}
        <path
          d="M10 60 A50 50 0 0 1 110 60"
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          pathLength="100" strokeDasharray="100" strokeDashoffset={100 - pct}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="font-display text-2xl -mt-7" style={{ color }}>
        {value.toFixed(decimals)}<span className="text-sm text-slate-400 ml-1">{unit}</span>
      </div>
    </div>
  )
}

export default GaugeCard