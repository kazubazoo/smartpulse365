import { severityColor } from '../lib/status'

// The latest reading scored against this machine's limits, by
// compute_health() in pdm-backend/main.py.
//
// health_percent is null when there is nothing to score — the motor is stopped,
// or the vibration sensor sent no reading — and the card then shows the state
// without a number. A stopped motor is not "100% healthy"; nobody measured it.
function HealthScoreCard({ health }) {
  const { health_percent, status_label, commentary, severity } = health
  const color = severityColor(severity)
  const scored = health_percent !== null && health_percent !== undefined

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col justify-center gap-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">
          Machine Health
        </span>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="font-display text-2xl" style={{ color }}>{status_label}</span>
        {scored && (
          <span className="font-display text-2xl text-slate-500">{health_percent}%</span>
        )}
      </div>
      <p className="font-body text-xs text-slate-400">{commentary}</p>
    </div>
  )
}

export default HealthScoreCard
