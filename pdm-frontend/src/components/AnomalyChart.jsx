import { memo, useMemo } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Scatter,
} from 'recharts'
import {
  GRID, AXIS_TICK, TOOLTIP_CONTENT, TOOLTIP_LABEL, LEGEND_WRAPPER,
  AXIS_STROKE, decimate,
} from '../utils/chartConfig'
import { axisFormatter, tooltipFormatter, timeTicks } from '../utils/time'

const DEFAULT_MAX_POINTS = 1500

function AnomalyChart({ data, floor, maxPoints = DEFAULT_MAX_POINTS,
                        windowSeconds, domainFrom, domainTo }) {
  const formatted = useMemo(() => {
    const reduced = decimate(data, maxPoints, 'peak_vibration')
    return reduced.map(r => ({
      t: r.t,
      peak_vibration: r.peak_vibration,
      upper_bound: r.upper_bound,
      lower_bound: r.lower_bound,
      // Only set a value when it's a real anomaly, so Scatter only plots those points.
      anomaly: (r.peak_vibration > r.upper_bound && r.peak_vibration > floor)
        ? r.peak_vibration : null,
    }))
  }, [data, floor, maxPoints])

  const domain = useMemo(() => [domainFrom, domainTo], [domainFrom, domainTo])
  const ticks = useMemo(() => timeTicks(domainFrom, domainTo), [domainFrom, domainTo])
  const tickFormat = useMemo(() => axisFormatter(windowSeconds), [windowSeconds])

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">
          Statistically-Driven Anomaly Detection
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={formatted}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="t" type="number" domain={domain} ticks={ticks}
            tickFormatter={tickFormat} stroke={AXIS_STROKE}
            tick={AXIS_TICK} minTickGap={50}
          />
          <YAxis stroke={AXIS_STROKE} tick={AXIS_TICK} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
            labelFormatter={tooltipFormatter}
          />
          <Legend wrapperStyle={LEGEND_WRAPPER} />
          <Line type="monotone" dataKey="upper_bound" stroke="#7b7b83" strokeDasharray="4 4" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="lower_bound" stroke="#7b7b83" strokeDasharray="4 4" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="peak_vibration" stroke="#38BDF8" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Scatter dataKey="anomaly" fill="#F87171" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(AnomalyChart)
