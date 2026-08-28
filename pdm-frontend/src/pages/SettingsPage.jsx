import { useSettings } from '../contexts/settingsStore'
import { TIME_RANGES, REFRESH_INTERVALS } from '../lib/defaults'
import { authConfigured } from '../lib/supabase'

function Panel({ title, hint, children }) {
  return (
    <section className="bg-bg-panel border border-border-glow rounded-xl p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
        <h2 className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</h2>
      </div>
      {hint && <p className="text-xs text-slate-500 mb-4 max-w-2xl">{hint}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  )
}

function NumberField({ label, value, onChange, unit, step = 0.1, min = 0, max, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
          className="w-full bg-bg-deep border border-border-glow rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent-cyan font-mono"
        />
        {unit && <span className="text-xs text-slate-500 shrink-0 w-10">{unit}</span>}
      </div>
      {hint && <span className="text-[11px] text-slate-600 leading-snug">{hint}</span>}
    </label>
  )
}

function SelectField({ label, value, onChange, options, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-bg-deep border border-border-glow rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent-cyan cursor-pointer"
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {hint && <span className="text-[11px] text-slate-600 leading-snug">{hint}</span>}
    </label>
  )
}

function SettingsPage() {
  const { settings: s, update, updateGauge, reset, syncState } = useSettings()

  const syncLabel = {
    saving: 'Saving…',
    saved: 'Saved to your account',
    error: 'Save failed — kept locally',
    idle: authConfigured ? 'Synced to your account' : 'Stored in this browser',
  }[syncState]

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-slate-50 text-xl">Settings</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{syncLabel}</span>
          <button
            onClick={reset}
            className="text-xs text-slate-400 border border-border-glow rounded-lg px-3 py-1.5 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <Panel
        title="Default View"
        hint="Applied when the dashboard loads. The picker at the top of each page changes it for the current session and saves it back here."
      >
        <SelectField
          label="Time range"
          value={s.rangeId}
          onChange={v => update({ rangeId: v })}
          options={TIME_RANGES}
        />
        <SelectField
          label="Auto-refresh"
          value={s.refreshId}
          onChange={v => update({ refreshId: v })}
          options={REFRESH_INTERVALS.map(r => ({ ...r, label: r.id === 'off' ? 'Off' : r.label }))}
          hint="Windows of 15 minutes or less tail live at 1 Hz; longer windows refetch at this interval."
        />
        <NumberField
          label="Chart resolution"
          value={s.maxPoints}
          onChange={v => update({ maxPoints: Math.round(v) })}
          unit="pts"
          step={100}
          min={100}
          max={10000}
          hint="Point budget per chart. The API buckets longer windows down to fit."
        />
      </Panel>

      <Panel
        title="Vibration Thresholds"
        hint="ISO 10816-3 zone boundaries. These drive the health score, the status banner and the fault classifier — all evaluated server-side against these values."
      >
        <NumberField
          label="Warning (Zone B → C)"
          value={s.vibWarn}
          onChange={v => update({ vibWarn: v })}
          unit="mm/s"
          hint="Above this, an axis raises a fault row in Root Cause History."
        />
        <NumberField
          label="Critical (Zone C → D)"
          value={s.vibCritical}
          onChange={v => update({ vibCritical: v })}
          unit="mm/s"
          hint="Damage-level vibration; escalates the urgency wording."
        />
        <NumberField
          label="Health score full-scale"
          value={s.vibScale}
          onChange={v => update({ vibScale: v })}
          unit="mm/s"
          min={0.1}
          hint="Peak vibration that maps to a health score of 0."
        />
      </Panel>

      <Panel
        title="Temperature Thresholds"
        hint="Motor body temperature read from the PLC, not the sensor's own chip temperature."
      >
        <NumberField
          label="Warning"
          value={s.tempWarn}
          onChange={v => update({ tempWarn: v })}
          unit="°C"
          step={1}
        />
        <NumberField
          label="Critical"
          value={s.tempCritical}
          onChange={v => update({ tempCritical: v })}
          unit="°C"
          step={1}
        />
      </Panel>

      <Panel
        title="Anomaly Detection"
        hint="A rolling mean with a band of ±sigma standard deviations. Points above the upper band count as anomalies. Widen sigma to reduce false positives, narrow it to catch subtler excursions."
      >
        <NumberField
          label="Sigma multiplier"
          value={s.sigma}
          onChange={v => update({ sigma: v })}
          unit="σ"
          min={0.1}
          max={10}
          hint="3σ flags roughly the top 0.1% of a normal distribution."
        />
        <NumberField
          label="Rolling window"
          value={s.lookback}
          onChange={v => update({ lookback: Math.round(v) })}
          unit="pts"
          step={1}
          min={2}
          max={500}
          hint="Samples the mean and deviation are computed over."
        />
        <NumberField
          label="Noise floor"
          value={s.anomalyFloor}
          onChange={v => update({ anomalyFloor: v })}
          unit="mm/s"
          hint="Excursions below this absolute value are ignored, so a quiet machine doesn't flag its own noise."
        />
      </Panel>

      <Panel
        title="Root Cause History"
        hint="The fault table on the Diagnostics page."
      >
        <NumberField
          label="Rows to show"
          value={s.rootCauseLimit}
          onChange={v => update({ rootCauseLimit: Math.round(v) })}
          unit="rows"
          step={1}
          min={1}
          max={500}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Scope</span>
          <select
            value={s.rootCauseWindowed ? 'window' : 'all'}
            onChange={e => update({ rootCauseWindowed: e.target.value === 'window' })}
            className="bg-bg-deep border border-border-glow rounded-lg px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-accent-cyan cursor-pointer"
          >
            <option value="window">Selected time range</option>
            <option value="all">All retained history</option>
          </select>
          <span className="text-[11px] text-slate-600 leading-snug">
            Whether faults are limited to the range chosen in the picker.
          </span>
        </label>
      </Panel>

      <Panel
        title="Overview Gauge Ranges"
        hint="Full-scale value of each gauge arc. Set these to your motor's nameplate ratings so the arcs read meaningfully."
      >
        <NumberField label="Voltage" value={s.gauges.voltage} onChange={v => updateGauge('voltage', v)} unit="V" step={10} />
        <NumberField label="Current" value={s.gauges.current} onChange={v => updateGauge('current', v)} unit="A" step={1} />
        <NumberField label="Torque" value={s.gauges.torque} onChange={v => updateGauge('torque', v)} unit="%" step={5} />
        <NumberField label="Power" value={s.gauges.power} onChange={v => updateGauge('power', v)} unit="kW" step={1} />
        <NumberField label="Frequency" value={s.gauges.frequency} onChange={v => updateGauge('frequency', v)} unit="Hz" step={5} />
        <NumberField label="Temperature" value={s.gauges.temperature} onChange={v => updateGauge('temperature', v)} unit="°C" step={5} />
      </Panel>
    </div>
  )
}

export default SettingsPage
