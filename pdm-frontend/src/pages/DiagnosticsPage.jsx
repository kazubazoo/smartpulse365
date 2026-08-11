import { useEffect, useRef, useState } from 'react'
import TimeSeriesChart from '../components/TimeSeriesChart'
import HealthScoreCard from '../components/HealthScoreCard'
import AnomalyChart from '../components/AnomalyChart'
import RootCauseHistoryTable from '../components/RootCauseHistoryTable'
import StatCard from '../components/StatCard'
import { normalizeRow } from '../utils/time'
import { SET_VS_ACTUAL_FREQ, VIBRATION, DISPLACEMENT, FREQUENCY, VHZ, LOAD, CURRENT_TORQUE, ACCELERATION } from '../panels'

const WINDOW_MS = 5 * 60 * 1000
const ANOMALY_FLOOR = 0.5

function DiagnosticsPage() {
  const [history, setHistory] = useState([])
  const [health, setHealth] = useState(null)
  const [anomalies, setAnomalies] = useState([])
  const [rootCause, setRootCause] = useState([])
  const cursorRef = useRef(null)
  const isFetchingRef = useRef(false)

  useEffect(() => {
    fetch('/api/machines/motor01/history?minutes=5')
      .then(res => res.json())
      .then(rows => {
        setHistory(rows.map(normalizeRow))
        if (rows.length > 0) cursorRef.current = rows[rows.length - 1].time
      })
      .catch(err => console.error('Initial history fetch failed:', err))
  }, [])

  useEffect(() => {
    const pollDelta = () => {
      if (!cursorRef.current || isFetchingRef.current) return
      isFetchingRef.current = true
      fetch(`/api/machines/motor01/history/latest?since=${encodeURIComponent(cursorRef.current)}`)
        .then(res => res.json())
        .then(newRows => {
          if (newRows.length === 0) return
          cursorRef.current = newRows[newRows.length - 1].time
          const normalized = newRows.map(normalizeRow)
          setHistory(prev => {
            const byTime = new Map(prev.map(r => [r.time, r]))
            for (const row of normalized) byTime.set(row.time, row)
            const cutoff = Date.now() - WINDOW_MS
            return Array.from(byTime.values()).filter(r => r.t >= cutoff)
          })
        })
        .catch(err => console.error('Delta history fetch failed:', err))
        .finally(() => { isFetchingRef.current = false })
    }
    const id = setInterval(pollDelta, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchHealth = () => {
      fetch('/api/machines/motor01/health')
        .then(res => res.json())
        .then(setHealth)
        .catch(err => console.error('Health fetch failed:', err))
    }
    fetchHealth()
    const id = setInterval(fetchHealth, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchAnomalies = () => {
      fetch('/api/machines/motor01/anomalies?minutes=5')
        .then(res => res.json())
        .then(rows => setAnomalies(rows.map(normalizeRow)))
        .catch(err => console.error('Anomaly fetch failed:', err))
    }
    fetchAnomalies()
    const id = setInterval(fetchAnomalies, 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const fetchRootCause = () => {
      fetch('/api/machines/motor01/root-cause-history?limit=10')
        .then(res => res.json())
        .then(rows => setRootCause(rows.map(normalizeRow)))
        .catch(err => console.error('Root cause fetch failed:', err))
    }
    fetchRootCause()
    const id = setInterval(fetchRootCause, 5000)
    return () => clearInterval(id)
  }, [])

  const anomalyCount = anomalies.filter(
    r => r.peak_vibration > r.upper_bound && r.peak_vibration > ANOMALY_FLOOR
  ).length

  return (
    <div>
      <h1 className="font-display text-slate-200 text-xl mb-2">Diagnostics</h1>
      <p className="text-slate-500 text-xs mb-6">history rows: {history.length}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {health && <HealthScoreCard health={health} />}
        <RootCauseHistoryTable rows={rootCause} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Anomalies" value={anomalyCount} unit="" statusColor={anomalyCount > 0 ? '#FBBF24' : '#34D399'} />
        <div className="md:col-span-2">
          <AnomalyChart data={anomalies} floor={ANOMALY_FLOOR} />
        </div>
      </div>

      <div className="mb-6">
        <TimeSeriesChart title="3-Axis Vibration Velocity (mm/s)" data={history} series={VIBRATION} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TimeSeriesChart title="3-Axis Vibration Displacement (µm)" data={history} series={DISPLACEMENT} />
        <TimeSeriesChart title="Dominant Frequency vs Shaft Speed (Hz)" data={history} series={FREQUENCY} showLegend />
      </div>

      {/* 2x2 electrical/mechanical panel set, matching the original dashboard sequence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TimeSeriesChart title="Set Frequency vs Actual Frequency" data={history} series={SET_VS_ACTUAL_FREQ} showLegend />
        <TimeSeriesChart title="Mechanical Load Analysis" data={history} series={LOAD} dualAxis showLegend />
        <TimeSeriesChart title="V/Hz Efficiency Control" data={history} series={VHZ} dualAxis showLegend />
        <TimeSeriesChart title="Electromechanical Efficiency" data={history} series={CURRENT_TORQUE} dualAxis showLegend />
      </div>

      <div>
        <TimeSeriesChart title="3-Axis Vibration Acceleration (g)" data={history} series={ACCELERATION} />
        <p className="text-slate-500 text-xs mt-2">
          Known hardware limitation: acceleration registers return hard zeros on this sensor's firmware
          (velocity is derived internally but raw acceleration isn't exposed). Kept visible as an open item
          rather than removed.
        </p>
      </div>
    </div>
  )
}

export default DiagnosticsPage