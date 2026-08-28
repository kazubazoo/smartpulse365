import { memo } from 'react'
import { TIME_RANGES, REFRESH_INTERVALS } from '../lib/defaults'
import { useSettings } from '../contexts/settingsStore'

const SELECT_CLASS =
  'bg-bg-panel border border-border-glow rounded-lg px-3 py-1.5 text-xs text-slate-200 ' +
  'outline-none focus:border-accent-cyan cursor-pointer'

function TimeRangePicker({ resolutionNote }) {
  const { settings, update } = useSettings()

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {resolutionNote && (
        <span className="text-[11px] text-slate-500 font-mono mr-1">{resolutionNote}</span>
      )}

      <select
        aria-label="Time range"
        value={settings.rangeId}
        onChange={e => update({ rangeId: e.target.value })}
        className={SELECT_CLASS}
      >
        {TIME_RANGES.map(r => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>

      <select
        aria-label="Refresh interval"
        value={settings.refreshId}
        onChange={e => update({ refreshId: e.target.value })}
        className={SELECT_CLASS}
        title="Auto-refresh interval"
      >
        {REFRESH_INTERVALS.map(r => (
          <option key={r.id} value={r.id}>
            {r.id === 'off' ? 'Refresh: Off' : `Refresh: ${r.label}`}
          </option>
        ))}
      </select>
    </div>
  )
}

export default memo(TimeRangePicker)
