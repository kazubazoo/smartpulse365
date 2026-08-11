import { memo, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { GRID, AXIS_TICK, TOOLTIP_CONTENT, TOOLTIP_LABEL, LEGEND_WRAPPER, AXIS_STROKE, decimate } from '../utils/chartConfig'

const MAX_POINTS = 600

function TimeSeriesChart({ title, data, series, dualAxis = false, showLegend = false }) {
  const formatted = useMemo(() => {
    const reduced = decimate(data, MAX_POINTS, series[0].field)
    return reduced.map(r => {
      const row = { time: r.label }
      for (const s of series) row[s.name] = s.derive ? s.derive(r) : r[s.field]
      return row
    })
  }, [data, series])

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-400">{title}</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formatted}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="time" stroke={AXIS_STROKE} tick={AXIS_TICK} minTickGap={40} />
          {dualAxis ? (
            <>
              <YAxis yAxisId="left" stroke="#38BDF8" tick={AXIS_TICK} />
              <YAxis yAxisId="right" orientation="right" stroke="#34D399" tick={AXIS_TICK} />
            </>
          ) : (
            <YAxis stroke={AXIS_STROKE} tick={AXIS_TICK} />
          )}
          <Tooltip contentStyle={TOOLTIP_CONTENT} labelStyle={TOOLTIP_LABEL} />
          {showLegend && <Legend wrapperStyle={LEGEND_WRAPPER} />}
          {series.map(s => (
            <Line
              key={s.name}
              {...(dualAxis ? { yAxisId: s.axis } : {})}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(TimeSeriesChart)