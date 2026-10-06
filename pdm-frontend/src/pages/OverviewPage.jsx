import MachineCard from '../components/MachineCard'
import { needsAttention } from '../lib/status'

function OverviewPage({ machines, loading, onOpenMachine }) {
  if (loading && machines.length === 0) {
    return <p className="text-slate-500 text-sm">Loading machines…</p>
  }

  if (machines.length === 0) {
    return <p className="text-slate-500 text-sm">No machines are configured.</p>
  }

  const online = machines.filter(m => m.online).length
  // By severity, not by matching label text — a stopped motor is a normal
  // state and must not be counted as needing attention.
  const alarms = machines.filter(m => m.online && needsAttention(m.severity)).length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-slate-50 text-xl">Overview</h1>
        <p className="text-xs text-slate-500">
          {online} of {machines.length} online
          {alarms > 0 && <span className="text-status-amber ml-2">· {alarms} needing attention</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {machines.map(m => (
          <MachineCard key={m.id} machine={m} onOpen={onOpenMachine} />
        ))}
      </div>
    </div>
  )
}

export default OverviewPage
