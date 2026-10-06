import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TimeSeriesChart from '../components/TimeSeriesChart'
import FaultCodeTimeline from '../components/FaultCodeTimeline'
import HealthScoreCard from '../components/HealthScoreCard'
import AnomalyChart from '../components/AnomalyChart'
import RootCauseHistoryTable from '../components/RootCauseHistoryTable'
import GaugeCard from '../components/GaugeCard'
import TimeRangePicker from '../components/TimeRangePicker'
import { normalizeRow } from '../utils/time'
import { apiFetch } from '../lib/api'
import { RUN_STATE_COLOR, runStateFor } from '../lib/status'
import { useSettings } from '../contexts/settingsStore'
import { useMachines } from '../contexts/machinesStore'
import { rangeSeconds, refreshMs, toQuery, LIVE_TAIL_MAX_SECONDS } from '../lib/defaults'
import {
  ACTUAL_FREQ, VIBRATION, DISPLACEMENT, FREQUENCY,
  VHZ, LOAD, CURRENT_TORQUE, THERMAL, FAULT_CODES,
} from '../panels'

// Everything about one machine: live gauges, health, fault history, anomaly
// detection and the full set of trend charts. App.jsx remounts this page
// (key={machineId}) whenever the machine changes, so every series, cursor and
// timer starts clean and one machine's data cannot bleed into another's charts.
function DiagnosticsPage({ machines, machineId, onSelectMachine }) {
  const { settings } = useSettings()
  // Alarm limits and analytic tuning come from the machine being viewed, not
  // from the operator's preferences — see lib/standards.js.
  const { configFor } = useMachines()
  const [history, setHistory] = useState([])
  const [latest, setLatest] = useState(null)
  const [health, setHealth] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const [rootCause, setRootCause] = useState([])
  const [windowEnd, setWindowEnd] = useState(() => Date.now())

  // One slot per request. Each poll clears its own slot when it next succeeds,
  // so a transient failure disappears once that request recovers. A single
  // shared message used to be cleared only by the history load — which, while
  // live-tailing, runs exactly once — so one blip left the banner up for good.
  const [errors, setErrors] = useState({})
  const reportError = useCallback((source, err) => {
    if (err?.name === 'AbortError') return
    setErrors(e => ({ ...e, [source]: err.message }))
  }, [])
  const clearError = useCallback((source) => {
    setErrors(e => {
      if (!(source in e)) return e
      const next = { ...e }
      delete next[source]
      return next
    })
  }, [])

  const cursorRef = useRef(null)
  const isFetchingRef = useRef(false)

  const seconds = rangeSeconds(settings.rangeId)
  const interval = refreshMs(settings.refreshId)
  const liveTail = seconds <= LIVE_TAIL_MAX_SECONDS && interval > 0

  const config = configFor(machineId)
  const g = config.gauges

  const { vibWarn, vibCritical, vibScale, tempWarn, tempCritical } = config
  const thresholdQuery = useMemo(
    () => toQuery({
      vib_warn: vibWarn, vib_critical: vibCritical, vib_scale: vibScale,
      temp_warn: tempWarn, temp_critical: tempCritical,
    }),
    [vibWarn, vibCritical, vibScale, tempWarn, tempCritical]
  )

  const machine = machines.find(m => m.id === machineId)

  useEffect(() => {
    if (!machineId) return
    const fetchLatest = () =>
      apiFetch(`/api/machines/${machineId}/latest`)
        .then(row => { setLatest(row); clearError('latest') })
        .catch(err => reportError('latest', err))
    fetchLatest()
    if (interval <= 0) return
    const id = setInterval(fetchLatest, interval)
    return () => clearInterval(id)
  }, [machineId, interval, clearError, reportError])

  // Advance the shared chart window on the refresh cadence.
  useEffect(() => {
    const tick = () => setWindowEnd(Date.now())
    const id = setInterval(tick, Math.max(interval || 5000, 1000))
    return () => clearInterval(id)
  }, [interval])

  // Full history for the window. Short windows load once and are then kept
  // current by the delta poll below; long windows are refetched on a timer,
  // because the API buckets them server-side and a delta would not fit the
  // buckets.
  useEffect(() => {
    if (!machineId) return
    const ctrl = new AbortController()
    let cancelled = false

    const loadHistory = () => {
      const qs = toQuery({ seconds, max_points: settings.maxPoints })
      apiFetch(`/api/machines/${machineId}/history?${qs}`, { signal: ctrl.signal })
        .then(({ rows }) => {
          if (cancelled) return
          setHistory(rows.map(normalizeRow))
          clearError('history')
          cursorRef.current = rows.length ? rows[rows.length - 1].time : null
        })
        .catch(err => { if (!cancelled) reportError('history', err) })
    }

    loadHistory()
    let id
    if (!liveTail && interval > 0) id = setInterval(loadHistory, Math.max(interval, 5000))
    return () => { cancelled = true; ctrl.abort(); clearInterval(id) }
  }, [machineId, seconds, settings.maxPoints, liveTail, interval, clearError, reportError])

  // Live tail: fetch only the rows newer than the last one held, merge them in
  // by timestamp, and drop anything that has scrolled out of the window.
  useEffect(() => {
    if (!liveTail || !machineId) return

    const pollDelta = () => {
      if (!cursorRef.current || isFetchingRef.current) return
      isFetchingRef.current = true
      apiFetch(`/api/machines/${machineId}/history/latest?${toQuery({ since: cursorRef.current })}`)
        .then(newRows => {
          clearError('tail')
          if (!newRows.length) return
          cursorRef.current = newRows[newRows.length - 1].time
          const normalized = newRows.map(normalizeRow)
          setHistory(prev => {
            const byTime = new Map(prev.map(r => [r.time, r]))
            for (const row of normalized) byTime.set(row.time, row)
            const cutoff = Date.now() - seconds * 1000
            return Array.from(byTime.values())
              .filter(r => r.t >= cutoff)
              .sort((a, b) => a.t - b.t)
          })
        })
        .catch(err => reportError('tail', err))
        .finally(() => { isFetchingRef.current = false })
    }

    const id = setInterval(pollDelta, interval)
    return () => clearInterval(id)
  }, [machineId, liveTail, interval, seconds, clearError, reportError])

  useEffect(() => {
    if (!machineId) return
    const fetchHealth = () =>
      apiFetch(`/api/machines/${machineId}/health?${thresholdQuery}`)
        .then(h => { setHealth(h); clearError('health') })
        .catch(err => reportError('health', err))
    fetchHealth()
    if (interval <= 0) return
    const id = setInterval(fetchHealth, Math.max(interval, 2000))
    return () => clearInterval(id)
  }, [machineId, thresholdQuery, interval, clearError, reportError])

  useEffect(() => {
    if (!machineId) return
    const qs = toQuery({
      seconds, sigma: config.sigma,
      lookback: config.lookback, max_points: settings.maxPoints,
    })
    const fetchAnomalies = () =>
      apiFetch(`/api/machines/${machineId}/anomalies?${qs}`)
        .then(rows => { setAnomalies(rows.map(normalizeRow)); clearError('anomalies') })
        .catch(err => reportError('anomalies', err))
    fetchAnomalies()
    if (interval <= 0) return
    const id = setInterval(fetchAnomalies, Math.max(interval, 2000))
    return () => clearInterval(id)
  }, [machineId, seconds, config.sigma, config.lookback, settings.maxPoints, interval,
      clearError, reportError])

  useEffect(() => {
    if (!machineId) return
    const qs = `${thresholdQuery}&${toQuery({
      limit: settings.rootCauseLimit,
      seconds: settings.rootCauseWindowed ? seconds : 0,
    })}`
    const fetchRootCause = () =>
      apiFetch(`/api/machines/${machineId}/root-cause-history?${qs}`)
        .then(rows => { setRootCause(rows.map(normalizeRow)); clearError('rootCause') })
        .catch(err => reportError('rootCause', err))
    fetchRootCause()
    if (interval <= 0) return
    const id = setInterval(fetchRootCause, Math.max(interval, 5000))
    return () => clearInterval(id)
  }, [machineId, thresholdQuery, settings.rootCauseLimit, settings.rootCauseWindowed,
      seconds, interval, clearError, reportError])

  const anomalyCount = useMemo(
    () => anomalies.filter(
      r => r.peak_vibration > r.upper_bound && r.peak_vibration > config.anomalyFloor
    ).length,
    [anomalies, config.anomalyFloor]
  )

  if (!machineId) {
    return <p className="text-slate-500 text-sm">No machine selected.</p>
  }

  // Same words and colours as the Overview card (lib/status.js). Derived from
  // the latest reading, which polls faster than the fleet roll-up.
  const state = runStateFor(machine?.online, latest?.status_code)
  const stateColor = RUN_STATE_COLOR[state]
  const online = state !== 'OFFLINE'

  // Distinct messages only: when the API is down, every request fails with
  // the same error, and listing it five times says nothing more.
  const errorMessages = [...new Set(Object.values(errors))]

  // Every chart shares one window, so they line up and scroll together.
  const win = { windowSeconds: seconds, domainFrom: windowEnd - seconds * 1000, domainTo: windowEnd }
  const hasLatest = latest && Object.keys(latest).length > 0
  const temp = latest?.temperature

  return (
    <div>
      <h1 className="font-display text-slate-50 text-xl mb-4">Diagnostics</h1>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            aria-label="Machine"
            value={machineId}
            onChange={e => onSelectMachine(e.target.value)}
            className="bg-bg-panel border border-border-glow rounded-lg px-3 py-2
                       font-display text-slate-200 text-lg outline-none
                       focus:border-accent-cyan cursor-pointer"
          >
            {machines.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.online ? '' : ' (offline)'}
              </option>
            ))}
          </select>

          <span className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${online ? 'animate-pulse' : ''}`}
              style={{ background: stateColor, boxShadow: online ? `0 0 10px ${stateColor}` : 'none' }}
            />
            <span className="text-xs tracking-widest uppercase" style={{ color: stateColor }}>
              {state}
            </span>
          </span>
        </div>

        <TimeRangePicker />
      </div>

      {errorMessages.length > 0 && (
        <div className="bg-status-red/10 border border-status-red/30 text-status-red text-xs rounded-lg px-3 py-2 mb-4">
          {errorMessages.map(msg => <p key={msg}>{msg}</p>)}
        </div>
      )}

      {/* `{}` is truthy, so check for keys — an offline machine must not render
          a wall of gauges. Individual missing values render as "—", never 0. */}
      {hasLatest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <GaugeCard label="Voltage" value={latest.voltage} unit="V" max={g.voltage} color="#38BDF8" />
          <GaugeCard label="Current" value={latest.current} unit="A" max={g.current} color="#38BDF8" decimals={1} />
          <GaugeCard label="Torque" value={latest.torque} unit="%" max={g.torque} color="#34D399" />
          <GaugeCard label="Power" value={latest.power} unit="kW" max={g.power} color="#34D399" decimals={1} />
          <GaugeCard label="Frequency" value={latest.frequency} unit="Hz" max={g.frequency} color="#2563EB" decimals={1} />
          <GaugeCard
            label="Temperature" value={temp} unit="°C" max={g.temperature}
            color={temp > tempCritical ? '#F87171' : temp > tempWarn ? '#FBBF24' : '#34D399'}
          />
          <GaugeCard label="Speed" value={latest.rpm} unit="rpm" max={g.rpm} color="#38BDF8" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {health && Object.keys(health).length > 0 && <HealthScoreCard health={health} />}
        <RootCauseHistoryTable rows={rootCause} vibWarn={vibWarn} tempWarn={tempWarn} />
      </div>

      <div className="mb-6">
        <AnomalyChart
          data={anomalies}
          count={anomalyCount}
          floor={config.anomalyFloor}
          vibWarn={vibWarn}
          vibCritical={vibCritical}
          maxPoints={settings.maxPoints}
          {...win}
        />
      </div>

      <div className="mb-6">
        <TimeSeriesChart
          title="3-Axis Vibration Velocity (mm/s)"
          data={history} series={VIBRATION} maxPoints={settings.maxPoints} {...win}
          refLines={[
            { y: vibWarn, color: '#FBBF24', label: 'Warn' },
            { y: vibCritical, color: '#F87171', label: 'Critical' },
          ]}
          showLegend
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* "microns", not "µm": the title is uppercased in CSS, and
            text-transform maps µ (U+00B5) to Greek capital Mu, so "µm" renders
            as "MM" — the wrong unit by a factor of a thousand. */}
        <TimeSeriesChart title="Vibration Displacement (microns)" data={history}
          series={DISPLACEMENT} maxPoints={settings.maxPoints} {...win} showLegend />
        <TimeSeriesChart title="Dominant Frequency vs Shaft Speed (Hz)" data={history}
          series={FREQUENCY} maxPoints={settings.maxPoints} {...win} showLegend />
      </div>

      {/* Paired: neither needs full width. The fault lanes are short, and
          temperature is a slow-moving trace, so side by side they read as one
          "is anything wrong?" row. The timeline stretches to the chart's height. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <FaultCodeTimeline
          title="Per-Axis Fault Diagnosis Codes"
          data={history} series={FAULT_CODES} {...win}
          note="Codes are reported per axis by the vibration sensor. A blank lane means no reading arrived, not that the axis was healthy."
        />
        <TimeSeriesChart
          title="Motor Temperature (°C)"
          data={history} series={THERMAL} maxPoints={settings.maxPoints} {...win}
          refLines={[
            { y: tempWarn, color: '#FBBF24', label: 'Warn' },
            { y: tempCritical, color: '#F87171', label: 'Critical' },
          ]}
          showLegend
        />
      </div>

      {/* Dual-axis charts: the title names both quantities with their units,
          and each axis is tinted to match its series, so the two scales cannot
          be confused. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TimeSeriesChart title="Output Frequency (Hz)" data={history}
          series={ACTUAL_FREQ} maxPoints={settings.maxPoints} {...win} showLegend
          note="Commanded set frequency is not published by this PLC, so only the measured output is shown." />
        <TimeSeriesChart title="Speed (rpm) and Power (kW)" data={history}
          series={LOAD} maxPoints={settings.maxPoints} {...win} dualAxis showLegend />
        <TimeSeriesChart title="Voltage (V) and Frequency (Hz)" data={history}
          series={VHZ} maxPoints={settings.maxPoints} {...win} dualAxis showLegend />
        <TimeSeriesChart title="Current (A) and Torque (%)" data={history}
          series={CURRENT_TORQUE} maxPoints={settings.maxPoints} {...win} dualAxis showLegend />
      </div>
    </div>
  )
}

export default DiagnosticsPage
