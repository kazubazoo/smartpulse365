import { memo } from 'react'
import { RUN_STATE_COLOR, severityColor } from '../lib/status'

function relativeAge(seconds) {
  if (seconds === null || seconds === undefined) return 'never reported'
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}

function Metric({ label, value, unit, decimals = 1 }) {
  const shown = value === null || value === undefined
    ? '—'
    : Number(value).toFixed(decimals)
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-slate-500 tracking-wide">{label}</span>
      <span className="font-display text-slate-200 text-lg leading-tight">
        {shown}
        {shown !== '—' && <span className="text-xs text-slate-500 ml-1">{unit}</span>}
      </span>
    </div>
  )
}

function MachineCard({ machine, onOpen }) {
  const { name, online, health_percent, status_label, severity } = machine
  const state = machine.run_state ?? (online ? 'UNKNOWN' : 'OFFLINE')
  const hc = severityColor(severity)
  const dot = RUN_STATE_COLOR[state] ?? RUN_STATE_COLOR.UNKNOWN
  const anomalies = machine.anomaly_count ?? 0
  // No percentage while the motor is stopped or vibration data is missing —
  // see compute_health() in pdm-backend/main.py.
  const scored = health_percent !== null && health_percent !== undefined

  return (
    <button
      onClick={() => onOpen(machine.id)}
      className={`text-left bg-bg-panel border rounded-xl p-5 transition-colors w-full
                  hover:border-accent-cyan/50 ${
        online ? 'border-border-glow' : 'border-border-glow/50 opacity-70'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${online ? 'animate-pulse' : ''}`}
            style={{ background: dot, boxShadow: online ? `0 0 10px ${dot}` : 'none' }}
          />
          <span className="font-display text-slate-200 text-lg truncate">{name}</span>
        </div>
        <span
          className="text-[11px] tracking-widest uppercase shrink-0 ml-2"
          style={{ color: online ? dot : '#64748B' }}
        >
          {state}
        </span>
      </div>

      {online ? (
        <>
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs" style={{ color: hc }}>{status_label}</span>
              {scored && (
                <span className="font-display text-sm" style={{ color: hc }}>
                  {health_percent}%
                </span>
              )}
            </div>
            {/* No bar at all when unscored: an empty track reads as 0%. */}
            {scored && (
              <div className="h-1.5 rounded-full bg-bg-deep overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${health_percent}%`, background: hc }}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col">
              <span className="text-[11px] text-slate-500 tracking-wide">Anomalies (1h)</span>
              <span
                className="font-display text-lg leading-tight"
                style={{ color: anomalies > 0 ? '#FBBF24' : '#34D399' }}
              >
                {anomalies}
              </span>
            </div>
            <Metric label="Temp" value={machine.temperature} unit="°C" />
            <Metric label="Frequency" value={machine.frequency} unit="Hz" />
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500 py-4">
          No data received — last seen {relativeAge(machine.age_seconds)}.
        </p>
      )}
    </button>
  )
}

export default memo(MachineCard)
