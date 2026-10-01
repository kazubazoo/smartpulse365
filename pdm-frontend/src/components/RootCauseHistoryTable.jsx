const FAULT_COLORS = {
  'Thermal Overload': '#F87171',
  'Axial Misalignment': '#FB923C',
  'Vertical Looseness': '#FBBF24',
  'Horizontal Unbalance': '#A78BFA',
}

function RootCauseHistoryTable({ rows, vibWarn, tempWarn }) {
  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">Root Cause History</span>
      </div>
      {rows.length === 0 ? (
        // "No data" invited the reasonable question of why a visible wobble on
        // the anomaly chart produced no entry here. This table lists readings
        // that crossed an alarm limit; the anomaly chart flags excursions
        // relative to the machine's own recent behaviour, which is a different
        // and much more sensitive test. Saying what was checked, and against
        // what, is the difference between "nothing wrong" and "not working".
        <div className="text-xs text-slate-500">
          <p>No reading crossed an alarm limit in this window.</p>
          {(vibWarn != null || tempWarn != null) && (
            <p className="mt-1 text-slate-600">
              Checked against
              {vibWarn != null && ` vibration ${vibWarn} mm/s`}
              {vibWarn != null && tempWarn != null && ' and'}
              {tempWarn != null && ` temperature ${tempWarn} °C`}.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-y-auto max-h-40 flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="text-xs">
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded font-body"
                  style={{ background: `${FAULT_COLORS[r.fault_type] ?? '#64748B'}22`, color: FAULT_COLORS[r.fault_type] ?? '#94A3B8' }}
                >
                  {r.fault_type}
                </span>
                <span className="text-slate-500">{r.label}</span>
              </div>
              <p className="text-slate-400 mt-0.5">{r.urgency}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default RootCauseHistoryTable