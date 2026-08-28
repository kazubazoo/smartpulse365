import { useEffect, useMemo, useRef, useState } from 'react'
import TimeSeriesChart from '../components/TimeSeriesChart'
import HealthScoreCard from '../components/HealthScoreCard'
import AnomalyChart from '../components/AnomalyChart'
import RootCauseHistoryTable from '../components/RootCauseHistoryTable'
import StatCard from '../components/StatCard'
import GaugeCard from '../components/GaugeCard'
import TimeRangePicker from '../components/TimeRangePicker'
import { normalizeRow } from '../utils/time'
import { apiFetch } from '../lib/api'
import { useSettings } from '../contexts/settingsStore'
import { rangeSeconds, refreshMs, toQuery, LIVE_TAIL_MAX_SECONDS } from '../lib/defaults'
import {
  SET_VS_ACTUAL_FREQ, VIBRATION, DISPLACEMENT, FREQUENCY,
  VHZ, LOAD, CURRENT_TORQUE, THERMAL,
} from '../panels'

const STATUS_MAP = { 0: 'E-STOP', 1: 'STOPPED', 2: 'RUNNING' }
const STATUS_COLOR = { 0: '#F87171', 1: '#38BDF8', 2: '#34D399' }

function DiagnosticsPage({ machines, machineId, onSelectMachine }) {
  const { settings } = useSettings()
  const [history, setHistory] = useState([])
  const [latest, setLatest] = useState(null)
  const [health, setHealth] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const [rootCause, setRootCause] = useState([])
  const [error, setError] = useState(null)
  const [windowEnd, setWindowEnd] = useState(() => Date.now())

  const cursorRef = useRef(null)
  const isFetchingRef = useRef(false)

  const seconds = rangeSeconds(settings.rangeId)
  const interval = refreshMs(settings.refreshId)
  const liveTail = seconds <= LIVE_TAIL_MAX_SECONDS && interval > 0
  const g = settings.gauges

  const { vibWarn, vibCritical, vibScale, tempWarn, tempCritical } = settings
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
        .then(setLatest)
        .catch(err => setError(err.message))
    fetchLatest()
    if (interval <= 0) return
    const id = setInterval(fetchLatest, interval)
    return () => clearInterval(id)
  }, [machineId, interval])

  // Advance the shared chart window on the refresh cadence.
  useEffect(() => {
    const tick = () => setWindowEnd(Date.now())
    const id = setInterval(tick, Math.max(interval || 5000, 1000))
    return () => clearInterval(id)
  }, [interval])

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
          setError(null)
          cursorRef.current = rows.length ? rows[rows.length - 1].time : null
        })
        .catch(err => { if (!cancelled && err.name !== 'AbortError') setError(err.message) })
    }

    loadHistory()
    let id
    if (!liveTail && interval > 0) id = setInterval(loadHistory, Math.max(interval, 5000))
    return () => { cancelled = true; ctrl.abort(); clearInterval(id) }
  }, [machineId, seconds, settings.maxPoints, liveTail, interval])

  useEffect(() => {
    if (!liveTail || !machineId) return

    const pollDelta = () => {
      if (!cursorRef.current || isFetchingRef.current) return
      isFetchingRef.current = true
      apiFetch(`/api/machines/${machineId}/history/latest?${toQuery({ since: cursorRef.current })}`)
        .then(newRows => {
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
        .catch(err => setError(err.message))
        .finally(() => { isFetchingRef.current = false })
    }

    const id = setInterval(pollDelta, interval)
    return () => clearInterval(id)
  }, [machineId, liveTail, interval, seconds])

  useEffect(() => {
    if (!machineId) return
    const fetchHealth = () =>
      apiFetch(`/api/machines/${machineId}/health?${thresholdQuery}`)
        .then(setHealth)
        .catch(err => setError(err.message))
    fetchHealth()
    if (interval <= 0) return
    const id = setInterval(fetchHealth, Math.max(interval, 2000))
    return () => clearInterval(id)
  }, [machineId, thresholdQuery, interval])

  useEffect(() => {
    if (!machineId) return
    const qs = toQuery({
      seconds, sigma: settings.sigma,
      lookback: settings.lookback, max_points: settings.maxPoints,
    })
    const fetchAnomalies = () =>
      apiFetch(`/api/machines/${machineId}/anomalies?${qs}`)
        .then(rows => setAnomalies(rows.map(normalizeRow)))
        .catch(err => setError(err.message))
    fetchAnomalies()
    if (interval <= 0) return
    const id = setInterval(fetchAnomalies, Math.max(interval, 2000))
    return () => clearInterval(id)
  }, [machineId, seconds, settings.sigma, settings.lookback, settings.maxPoints, interval])

  useEffect(() => {
    if (!machineId) return
    const qs = `${thresholdQuery}&${toQuery({
      limit: settings.rootCauseLimit,
      seconds: settings.rootCauseWindowed ? seconds : 0,
    })}`
    const fetchRootCause = () =>
      apiFetch(`/api/machines/${machineId}/root-cause-history?${qs}`)
        .then(rows => setRootCause(rows.map(normalizeRow)))
        .catch(err => setError(err.message))
    fetchRootCause()
    if (interval <= 0) return
    const id = setInterval(fetchRootCause, Math.max(interval, 5000))
    return () => clearInterval(id)
  }, [machineId, thresholdQuery, settings.rootCauseLimit, settings.rootCauseWindowed,
      seconds, interval])

  const anomalyCount = useMemo(
    () => anomalies.filter(
      r => r.peak_vibration > r.upper_bound && r.peak_vibration > settings.anomalyFloor
    ).length,
    [anomalies, settings.anomalyFloor]
  )

  if (!machineId) {
    return <p className="text-slate-500 text-sm">No machine selected.</p>
  }

  const online = machine?.online
  const statusColor = online ? STATUS_COLOR[latest?.status_code] ?? '#64748B' : '#64748B'
  const temp = latest?.temperature ?? 0

  return (
    <div>
      <h1 className="font-display text-slate-50 text-xl mb-4">Diagnostics</h1>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
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
              style={{
                background: statusColor,
                boxShadow: online ? `0 0 10px ${statusColor}` : 'none',
              }}
            />
            <span className="text-xs tracking-widest uppercase" style={{ color: statusColor }}>
              {online ? STATUS_MAP[latest?.status_code] ?? 'UNKNOWN' : 'OFFLINE'}
            </span>
          </span>
        </div>

        <TimeRangePicker />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      {/* `{}` is truthy — an offline machine must not render a wall of zeroed
          gauges that look like real readings. */}
      {latest && Object.keys(latest).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <GaugeCard label="Voltage" value={latest.voltage ?? 0} unit="V" max={g.voltage} color="#38BDF8" />
          <GaugeCard label="Current" value={latest.current ?? 0} unit="A" max={g.current} color="#38BDF8" decimals={1} />
          <GaugeCard label="Torque" value={latest.torque ?? 0} unit="%" max={g.torque} color="#34D399" />
          <GaugeCard label="Power" value={latest.power ?? 0} unit="kW" max={g.power} color="#34D399" decimals={1} />
          <GaugeCard label="Frequency" value={latest.frequency ?? 0} unit="Hz" max={g.frequency} color="#2563EB" decimals={1} />
          <GaugeCard
            label="Temperature" value={temp} unit="°C" max={g.temperature}
            color={temp > tempCritical ? '#F87171' : temp > tempWarn ? '#FBBF24' : '#34D399'}
          />
          <GaugeCard label="Speed" value={latest.rpm ?? 0} unit="rpm" max={1800} color="#38BDF8" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {health && Object.keys(health).length > 0 && <HealthScoreCard health={health} />}
        <RootCauseHistoryTable rows={rootCause} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total Anomalies"
          value={anomalyCount}
          unit=""
          statusColor={anomalyCount > 0 ? '#FBBF24' : '#34D399'}
        />
        <div className="md:col-span-2">
          <AnomalyChart
            data={anomalies}
            floor={settings.anomalyFloor}
            maxPoints={settings.maxPoints}
            windowSeconds={seconds}
            domainFrom={windowEnd - seconds * 1000}
            domainTo={windowEnd}
          />
        </div>
      </div>

      <div className="mb-6">
        <TimeSeriesChart
          title="3-Axis Vibration Velocity (mm/s)"
          data={history}
          series={VIBRATION}
          maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd}
          refLines={[
            { y: vibWarn, color: '#FBBF24', label: 'Warn' },
            { y: vibCritical, color: '#F87171', label: 'Critical' },
          ]}
          showLegend
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TimeSeriesChart title="Vibration Displacement (µm)" data={history} series={DISPLACEMENT} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} showLegend />
        <TimeSeriesChart title="Dominant Frequency vs Shaft Speed (Hz)" data={history} series={FREQUENCY} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} showLegend />
      </div>

      <div className="mb-6">
        <TimeSeriesChart
          title="Motor Temperature (°C)"
          data={history}
          series={THERMAL}
          maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd}
          refLines={[
            { y: tempWarn, color: '#FBBF24', label: 'Warn' },
            { y: tempCritical, color: '#F87171', label: 'Critical' },
          ]}
          showLegend
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TimeSeriesChart title="Set Frequency vs Actual Frequency" data={history} series={SET_VS_ACTUAL_FREQ} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} showLegend />
        <TimeSeriesChart title="Mechanical Load Analysis" data={history} series={LOAD} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} dualAxis showLegend />
        <TimeSeriesChart title="V/Hz Efficiency Control" data={history} series={VHZ} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} dualAxis showLegend />
        <TimeSeriesChart title="Electromechanical Efficiency" data={history} series={CURRENT_TORQUE} maxPoints={settings.maxPoints}
          windowSeconds={seconds} domainFrom={windowEnd - seconds * 1000} domainTo={windowEnd} dualAxis showLegend />
      </div>
    </div>
  )
}

export default DiagnosticsPage
