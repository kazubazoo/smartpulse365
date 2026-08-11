function HealthScoreCard({ health }) {
  const { health_percent, status_label, ai_commentary } = health
  const color = health_percent >= 75 ? '#34D399' : health_percent >= 50 ? '#FBBF24' : '#F87171'

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col justify-center gap-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
        <span className="font-body text-xs tracking-widest uppercase text-slate-400">
          System Health Score (ISO 10816)
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl" style={{ color }}>{status_label}</span>
        <span className="font-display text-2xl text-slate-500">{health_percent}</span>
      </div>
      <p className="font-body text-xs text-slate-400">{ai_commentary}</p>
    </div>
  )
}

export default HealthScoreCard