import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../contexts/settingsStore'
import { useMachines } from '../contexts/machinesStore'
import { authConfigured } from '../lib/supabase'
import Slider from '../components/inputs/Slider'
import SegmentedControl from '../components/inputs/SegmentedControl'
import SaveBar from '../components/SaveBar'
import {
  TIME_RANGES, REFRESH_INTERVALS, IDLE_TIMEOUTS,
  DEFAULT_UI_SETTINGS, DEFAULT_MACHINE_CONFIG,
  pickMachineConfig, stableStringify,
} from '../lib/defaults'
import {
  STANDARDS, getStandard, getStandardClass, resolveLimits,
  suggestClass, explainSuggestion, MOUNTING_OPTIONS, ZONE_NOTES,
} from '../lib/standards'

// A short-lived "Saved" acknowledgement. The flag is state cleared by a timer
// rather than a timestamp compared against the clock during render, so the
// component's output never depends on when it happens to re-render.
function useSavedFlash(ms = 4000) {
  const [justSaved, setJustSaved] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const flash = useCallback(() => {
    setJustSaved(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setJustSaved(false), ms)
  }, [ms])

  return [justSaved, flash]
}

// --------------------------------------------------------------------------
// Layout primitives
// --------------------------------------------------------------------------
function Panel({ title, hint, children, columns = 2 }) {
  return (
    <section className="bg-bg-panel border border-border-glow rounded-xl p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
        <h2 className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</h2>
      </div>
      {hint && <p className="text-xs text-slate-500 mb-4 max-w-3xl leading-relaxed">{hint}</p>}
      <div className={`grid grid-cols-1 gap-x-8 gap-y-5 ${
        columns === 3 ? 'lg:grid-cols-3 sm:grid-cols-2' : 'sm:grid-cols-2'
      }`}>
        {children}
      </div>
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-slate-300">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-500 leading-snug">{hint}</span>}
    </label>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-accent-cyan cursor-pointer"
    >
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

function TextInput({ value, onChange, placeholder, unit }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm text-slate-200 font-mono outline-none focus:border-accent-cyan"
      />
      {unit && <span className="text-xs text-slate-500 shrink-0 w-10">{unit}</span>}
    </div>
  )
}

// --------------------------------------------------------------------------
// Zone bar — shows where the limits sit inside the chosen standard
// --------------------------------------------------------------------------
function ZoneBar({ limits }) {
  if (!limits) return null
  const { zoneAB, vibWarn, vibCritical } = limits
  const top = vibCritical * 1.35
  const pct = v => `${Math.min(100, (v / top) * 100)}%`

  const zones = [
    { key: 'A', to: zoneAB ?? vibWarn * 0.4, color: 'var(--color-status-green)', title: 'Zone A — newly commissioned' },
    { key: 'B', to: vibWarn, color: '#0EA5E9', title: 'Zone B — good for long-term running' },
    { key: 'C', to: vibCritical, color: 'var(--color-status-amber)', title: 'Zone C — unsatisfactory long-term' },
    { key: 'D', to: top, color: 'var(--color-status-red)', title: 'Zone D — damaging' },
  ]

  let prev = 0
  const segments = zones.map(z => {
    const seg = { ...z, from: prev }
    prev = z.to
    return seg
  })

  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-slate-300">Severity zones</span>
        <span className="text-[11px] text-slate-500 font-mono">mm/s RMS</span>
      </div>
      <div className="relative h-8 rounded-lg overflow-hidden border border-border-glow bg-bg-deep flex">
        {segments.map(s => (
          <div
            key={s.key}
            title={s.title}
            className="h-full flex items-center justify-center text-[10px] font-mono text-bg-deep/90 font-bold"
            style={{
              width: `calc(${pct(s.to)} - ${pct(s.from)})`,
              background: s.color,
              opacity: 0.85,
            }}
          >
            {s.key}
          </div>
        ))}
      </div>
      <div className="relative h-5 mt-1 text-[10px] font-mono text-slate-500">
        {zoneAB != null && (
          <span className="absolute -translate-x-1/2" style={{ left: pct(zoneAB) }}>{zoneAB}</span>
        )}
        <span className="absolute -translate-x-1/2 text-status-amber" style={{ left: pct(vibWarn) }}>
          {vibWarn}
        </span>
        <span className="absolute -translate-x-1/2 text-status-red" style={{ left: pct(vibCritical) }}>
          {vibCritical}
        </span>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mt-1">
        Warning fires at the B/C boundary ({vibWarn} mm/s) and critical at C/D ({vibCritical} mm/s).
        {' '}{ZONE_NOTES.bc}
      </p>
    </div>
  )
}

// --------------------------------------------------------------------------
// Display preferences — per operator
// --------------------------------------------------------------------------
function DisplaySettings() {
  const { settings, update, reset, syncState } = useSettings()
  // Seeded once on mount, so opening the page always shows the live values but
  // an in-progress edit is never overwritten from underneath.
  const [draft, setDraft] = useState(settings)
  const [justSaved, flashSaved] = useSavedFlash()
  const [error, setError] = useState(null)

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings),
    [draft, settings],
  )

  const set = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), [])

  const onSave = async () => {
    setError(null)
    const result = await update(draft)
    if (result?.ok === false) setError(result.error?.message ?? 'Unknown error')
    else flashSaved()
  }

  return (
    <>
      <Panel
        title="Default view"
        hint="What the dashboard opens with. The pickers at the top of each page override this for the current session."
        columns={3}
      >
        <Field label="Time range">
          <Select value={draft.rangeId} onChange={v => set({ rangeId: v })} options={TIME_RANGES} />
        </Field>
        <Field
          label="Auto-refresh"
          hint="Windows of 15 minutes or less tail live at 1 Hz; longer windows refetch at this interval."
        >
          <SegmentedControl
            value={draft.refreshId}
            onChange={v => set({ refreshId: v })}
            options={REFRESH_INTERVALS}
            columns={6}
          />
        </Field>
        <Slider
          label="Chart resolution"
          value={draft.maxPoints}
          onChange={v => set({ maxPoints: Math.round(v) })}
          min={200} max={5000} step={100} unit="pts"
          marks={[{ value: 200, label: '200' }, { value: 5000, label: '5000' }]}
          hint="Point budget per chart. The API buckets longer windows down to fit. Higher is sharper but heavier on the browser."
        />
      </Panel>

      <Panel
        title="Session"
        hint="A plant terminal left unattended is a real risk. 30 minutes is the usual industrial compromise: long enough not to interrupt someone reading a trend, short enough that a walk-away is covered. A warning appears 60 seconds before sign-out."
      >
        <Field
          label="Sign out after inactivity"
          hint="Only mouse, keyboard, touch and scroll count as activity — the dashboard's own polling deliberately does not, or an unattended screen would stay signed in forever."
        >
          <SegmentedControl
            value={draft.idleTimeoutId}
            onChange={v => set({ idleTimeoutId: v })}
            options={IDLE_TIMEOUTS}
            columns={5}
          />
        </Field>
      </Panel>

      <Panel title="Fault history" hint="The Root Cause History table on the Diagnostics page.">
        <Slider
          label="Rows to show"
          value={draft.rootCauseLimit}
          onChange={v => set({ rootCauseLimit: Math.round(v) })}
          min={5} max={200} step={5} unit="rows"
        />
        <Field label="Scope">
          <SegmentedControl
            value={draft.rootCauseWindowed ? 'window' : 'all'}
            onChange={v => set({ rootCauseWindowed: v === 'window' })}
            options={[
              { id: 'window', label: 'Selected range' },
              { id: 'all', label: 'All history' },
            ]}
          />
        </Field>
      </Panel>

      <div className="flex justify-end">
        <button
          onClick={() => { reset(); setDraft(DEFAULT_UI_SETTINGS) }}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          Reset display preferences to defaults
        </button>
      </div>

      <SaveBar
        dirty={dirty}
        saving={syncState === 'saving'}
        justSaved={justSaved}
        error={error}
        onSave={onSave}
        onDiscard={() => { setDraft(settings); setError(null) }}
        scope={authConfigured ? 'your account' : 'this browser'}
      />
    </>
  )
}

// --------------------------------------------------------------------------
// Machine configuration — per asset
// --------------------------------------------------------------------------
function MachineSettings() {
  const { machines, storedConfigFor, saveMachineConfig, thresholdsColumn } = useMachines()
  const [selectedId, setSelectedId] = useState(null)

  const machineId = selectedId && machines.some(m => m.id === selectedId)
    ? selectedId
    : machines[0]?.id ?? null

  if (!machines.length) {
    return (
      <p className="text-sm text-slate-500">
        No machines yet. Add one on the Machines page first — alarm limits belong to a machine.
      </p>
    )
  }

  // Keyed on the machine: switching asset remounts the form, which reseeds the
  // draft from that machine's stored configuration without an effect syncing
  // state back and forth.
  return (
    <MachineConfigForm
      key={machineId}
      machineId={machineId}
      machines={machines}
      stored={storedConfigFor(machineId)}
      onSelectMachine={setSelectedId}
      saveMachineConfig={saveMachineConfig}
      thresholdsColumn={thresholdsColumn}
    />
  )
}

function MachineConfigForm({
  machineId, machines, stored, onSelectMachine, saveMachineConfig, thresholdsColumn,
}) {
  const [draft, setDraft] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [justSaved, flashSaved] = useSavedFlash()
  const [error, setError] = useState(null)

  // Order-independent: Postgres jsonb rearranges keys on the way back, so a
  // plain JSON.stringify comparison reported a difference after every
  // successful save and the Save bar never cleared.
  const dirty = useMemo(
    () => stableStringify(pickMachineConfig(draft)) !== stableStringify(stored),
    [draft, stored],
  )

  const set = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), [])
  const setGauge = useCallback((key, value) => {
    setDraft(d => ({ ...d, gauges: { ...d.gauges, [key]: value } }))
  }, [])

  const standard = getStandard(draft.standardId)
  const limits = resolveLimits(draft)
  const isCustom = draft.standardId === 'custom'

  const suggested = useMemo(() => suggestClass(draft.standardId, draft), [draft])
  const suggestionText = useMemo(() => explainSuggestion(draft.standardId, draft), [draft])

  // Switching standard invalidates the class, so land on a valid one.
  const changeStandard = (id) => {
    const next = getStandard(id)
    const fallback = suggestClass(id, draft) ?? next.classes[0]?.id ?? null
    set({ standardId: id, classId: fallback })
  }

  const onSave = async () => {
    setSaving(true)
    setError(null)
    const result = await saveMachineConfig(machineId, draft)
    setSaving(false)
    if (result?.error) setError(result.error.message)
    else flashSaved()
  }

  const machineOptions = machines.map(m => ({ id: m.id, label: m.name || m.id }))

  return (
    <>
      {!thresholdsColumn && (
        <div className="mb-4 rounded-lg border border-status-amber/40 bg-status-amber/10 px-4 py-3 text-xs text-status-amber">
          The machine registry has no <span className="font-mono">thresholds</span> column yet.
          Re-run <span className="font-mono">supabase/schema.sql</span> in the Supabase SQL editor
          to enable saving per-machine limits.
        </div>
      )}

      <Panel
        title="Machine"
        hint="Alarm limits belong to the equipment, not to the operator looking at it — a 2 kW fan and a 300 kW compressor cannot share a threshold. Every operator sees the machine scored against the same limits."
      >
        <Field label="Configuring">
          <Select value={machineId} onChange={onSelectMachine} options={machineOptions} />
        </Field>
        <Field
          label="Mounting"
          hint="How the machine is fixed down. Flexible mounts allow more movement, so the same reading is less severe."
        >
          <SegmentedControl
            value={draft.mounting}
            onChange={v => set({ mounting: v })}
            options={MOUNTING_OPTIONS}
          />
        </Field>
      </Panel>

      <Panel
        title="Vibration standard"
        hint="Pick the standard your site works to, then the class within it. The warning and critical limits come straight from the published table, so they cannot drift out of step with the class."
        columns={3}
      >
        <Field label="Standard" hint={standard?.blurb}>
          <Select
            value={draft.standardId}
            onChange={changeStandard}
            options={STANDARDS}
          />
        </Field>

        <Field label="Rated power" hint="From the nameplate. Used to suggest the class.">
          <TextInput
            value={draft.powerKw}
            onChange={v => set({ powerKw: v })}
            placeholder="e.g. 7.5"
            unit="kW"
          />
        </Field>

        <Field
          label="Shaft height"
          hint="Centre height of the shaft above the base. Optional, but it decides the ISO 20816-3 group outright."
        >
          <TextInput
            value={draft.shaftHeightMm}
            onChange={v => set({ shaftHeightMm: v })}
            placeholder="e.g. 132"
            unit="mm"
          />
        </Field>

        {!isCustom && (
          <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-2">
            <Field label={standard.classLabel} hint={suggestionText}>
              <Select
                value={draft.classId}
                onChange={v => set({ classId: v })}
                options={standard.classes}
              />
            </Field>
            <p className="text-[11px] text-slate-500 leading-snug">
              {getStandardClass(draft.standardId, draft.classId)?.detail}
            </p>
            {suggested && suggested !== draft.classId && (
              <button
                type="button"
                onClick={() => set({ classId: suggested })}
                className="self-start text-[11px] text-accent-cyan border border-accent-cyan/40 rounded-lg px-2.5 py-1 hover:bg-accent-cyan/10 transition-colors cursor-pointer"
              >
                Use suggested: {getStandardClass(draft.standardId, suggested)?.label}
              </button>
            )}
          </div>
        )}

        {isCustom ? (
          <>
            <Slider
              label="Warning limit"
              value={draft.vibWarn}
              onChange={v => set({ vibWarn: v })}
              min={0.1} max={20} step={0.1} unit="mm/s" tone="amber"
              hint={ZONE_NOTES.bc}
            />
            <Slider
              label="Critical limit"
              value={draft.vibCritical}
              onChange={v => set({ vibCritical: v })}
              min={0.1} max={30} step={0.1} unit="mm/s" tone="red"
              hint={ZONE_NOTES.cd}
            />
            <Slider
              label="Health score full-scale"
              value={draft.vibScale}
              onChange={v => set({ vibScale: v })}
              min={0.1} max={30} step={0.1} unit="mm/s"
              hint="Peak vibration that maps to a health score of 0."
            />
          </>
        ) : (
          <ZoneBar limits={limits} />
        )}
      </Panel>

      <Panel
        title="Temperature limits"
        hint="Motor body temperature read from the PLC, not the vibration sensor's own chip temperature."
      >
        <Slider
          label="Warning"
          value={draft.tempWarn}
          onChange={v => set({ tempWarn: v })}
          min={20} max={150} step={1} unit="°C" tone="amber"
        />
        <Slider
          label="Critical"
          value={draft.tempCritical}
          onChange={v => set({ tempCritical: v })}
          min={20} max={200} step={1} unit="°C" tone="red"
          hint="Above this the status banner reads CRITICAL: OVERHEAT."
        />
      </Panel>

      <Panel
        title="Anomaly detection"
        hint="A rolling mean with a band of ±sigma standard deviations. Points above the upper band count as anomalies. This is tuning for THIS machine's noise: a smooth direct-drive fan tolerates a tighter band than a reciprocating compressor."
        columns={3}
      >
        <Slider
          label="Sigma multiplier"
          value={draft.sigma}
          onChange={v => set({ sigma: v })}
          min={1} max={6} step={0.1} unit="σ"
          marks={[{ value: 1, label: 'sensitive' }, { value: 6, label: 'tolerant' }]}
          hint="3σ flags roughly the top 0.1% of a normal distribution. Lower catches more, including more false alarms."
        />
        <Slider
          label="Rolling window"
          value={draft.lookback}
          onChange={v => set({ lookback: Math.round(v) })}
          min={5} max={300} step={5} unit="pts"
          hint="Samples the mean and deviation are computed over. Longer is steadier but slower to react to a genuine shift."
        />
        <Slider
          label="Noise floor"
          value={draft.anomalyFloor}
          onChange={v => set({ anomalyFloor: v })}
          min={0} max={5} step={0.05} unit="mm/s"
          hint="Excursions below this absolute value are ignored, so a quiet machine does not flag its own noise."
        />
      </Panel>

      <Panel
        title="Gauge ranges"
        hint="Full-scale value of each gauge arc on the Diagnostics page. Set these to this machine's nameplate ratings so the arcs read meaningfully."
        columns={3}
      >
        <Slider label="Voltage" value={draft.gauges.voltage} onChange={v => setGauge('voltage', v)} min={50} max={1000} step={10} unit="V" />
        <Slider label="Current" value={draft.gauges.current} onChange={v => setGauge('current', v)} min={1} max={500} step={1} unit="A" />
        <Slider label="Torque" value={draft.gauges.torque} onChange={v => setGauge('torque', v)} min={10} max={200} step={5} unit="%" />
        <Slider label="Power" value={draft.gauges.power} onChange={v => setGauge('power', v)} min={1} max={1000} step={1} unit="kW" />
        <Slider label="Frequency" value={draft.gauges.frequency} onChange={v => setGauge('frequency', v)} min={10} max={400} step={5} unit="Hz" />
        <Slider label="Temperature" value={draft.gauges.temperature} onChange={v => setGauge('temperature', v)} min={40} max={250} step={5} unit="°C" />
      </Panel>

      <div className="flex justify-end">
        <button
          onClick={() => setDraft({ ...DEFAULT_MACHINE_CONFIG })}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          Reset this machine to defaults
        </button>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        justSaved={justSaved}
        error={error}
        onSave={onSave}
        onDiscard={() => { setDraft(stored); setError(null) }}
        scope={machines.find(m => m.id === machineId)?.name || machineId}
      />
    </>
  )
}

// --------------------------------------------------------------------------
function SettingsPage() {
  const [tab, setTab] = useState('machine')

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
        <h1 className="font-display text-slate-50 text-xl">Settings</h1>
      </div>

      <div className="mb-5">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { id: 'machine', label: 'Machine configuration', detail: 'Alarm limits and analytics, per asset' },
            { id: 'display', label: 'Display preferences', detail: 'Yours alone' },
          ]}
          columns={2}
        />
        <p className="text-[11px] text-slate-500 leading-snug mt-2">
          {tab === 'machine'
            ? 'Shared by everyone who views this machine — it describes the equipment.'
            : 'Yours alone. Changing these affects nobody else’s screen.'}
        </p>
      </div>

      {tab === 'machine' ? <MachineSettings /> : <DisplaySettings />}
    </div>
  )
}

export default SettingsPage
