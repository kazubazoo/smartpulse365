function StatCard({ label, value, unit, statusColor }) {
  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: statusColor || '#38BDF8' }} />
        <span className="font-body text-xs tracking-widest uppercase text-slate-400">{label}</span>
      </div>
      <div className="font-display text-3xl text-accent-cyan">
        {value}<span className="text-lg text-slate-400 ml-1">{unit}</span>
      </div>
    </div>
  )
}

export default StatCard