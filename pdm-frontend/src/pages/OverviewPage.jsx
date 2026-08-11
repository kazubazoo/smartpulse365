import GaugeCard from '../components/GaugeCard'

function OverviewPage({ latest }) {
  const statusMap = { 0: 'E-STOP', 1: 'STOPPED', 2: 'RUNNING' }
  const statusColorMap = { 0: '#F87171', 1: '#38BDF8', 2: '#34D399' }

  if (!latest) {
    return <p className="text-slate-500 text-sm">Loading motor data...</p>
  }

  const tempColor = latest.temperature > 55 ? '#F87171' : latest.temperature > 41 ? '#FBBF24' : '#34D399'

  return (
    <div>
      <h1 className="font-display text-slate-200 text-xl mb-6">Overview</h1>

      {/* Full-width state banner */}
      <div className="bg-bg-panel border border-border-glow rounded-xl p-6 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="w-3 h-3 rounded-full animate-pulse"
            style={{ background: statusColorMap[latest.status_code], boxShadow: `0 0 12px ${statusColorMap[latest.status_code]}` }}
          />
          <span className="font-display text-3xl" style={{ color: statusColorMap[latest.status_code] }}>
            {statusMap[latest.status_code] ?? 'UNKNOWN'}
          </span>
        </div>
        <span className="font-mono text-xs text-slate-500 uppercase tracking-widest">Motor 01 — Live</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <GaugeCard label="Voltage" value={latest.voltage} unit="V" max={200} color="#38BDF8" />
        <GaugeCard label="Current" value={latest.current} unit="A" max={15} color="#38BDF8" decimals={1} />
        <GaugeCard label="Torque" value={latest.torque} unit="%" max={100} color="#34D399" />
        <GaugeCard label="Power" value={latest.power} unit="kW" max={50} color="#34D399" decimals={1} />
        <GaugeCard label="Frequency" value={latest.frequency} unit="Hz" max={60} color="#2563EB" decimals={1} />
        <GaugeCard label="Temperature" value={latest.temperature} unit="°C" max={80} color={tempColor} />
      </div>
    </div>
  )
}

export default OverviewPage