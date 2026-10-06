import { memo, useMemo } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, Scatter,
} from 'recharts'
import {
  GRID, AXIS_TICK, TOOLTIP_CONTENT, TOOLTIP_LABEL, LEGEND_WRAPPER,
  AXIS_STROKE, decimate, tooltipValueFormatter,
} from '../utils/chartConfig'
import { axisFormatter, tooltipFormatter, timeTicks } from '../utils/time'

const DEFAULT_MAX_POINTS = 1500

// Peak vibration against a rolling ±sigma band computed from this machine's own
// recent behaviour (see _rolling_bounds in pdm-backend/main.py). A point above
// the band and above the noise floor is an anomaly.
//
// This is a *relative* test, so it is far more sensitive than the alarm limits:
// on an idle motor sitting at 0.00 mm/s, a twitch to 0.03 mm/s is many sigma
// out. Two things keep that from being misread:
//
//   * The warning and critical limits are drawn, and they hold the Y axis open,
//     the same rule as every other alarm-scaled chart. A small excursion then
//     looks small, because it is small next to the limit that matters.
//   * The lower band is clamped at zero for display. Vibration is a magnitude;
//     "mean minus 3 sigma" can fall below zero arithmetically, but drawing it
//     there spends half the chart on values that cannot exist.
function AnomalyChart({
  data, floor, vibWarn, vibCritical, count, maxPoints = DEFAULT_MAX_POINTS,
  windowSeconds, domainFrom, domainTo,
}) {
  const formatted = useMemo(() => {
    const reduced = decimate(data, maxPoints, 'peak_vibration')
    return reduced.map(r => ({
      t: r.t,
      peak: r.peak_vibration,
      upper: r.upper_bound,
      lower: r.lower_bound === null || r.lower_bound === undefined
        ? r.lower_bound
        : Math.max(0, r.lower_bound),
      // Only set when it is a real anomaly, so the scatter plots only those.
      anomaly: (r.peak_vibration > r.upper_bound && r.peak_vibration > floor)
        ? r.peak_vibration : null,
    }))
  }, [data, floor, maxPoints])

  const domain = useMemo(() => [domainFrom, domainTo], [domainFrom, domainTo])
  const ticks = useMemo(() => timeTicks(domainFrom, domainTo), [domainFrom, domainTo])
  const tickFormat = useMemo(() => axisFormatter(windowSeconds), [windowSeconds])

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse shrink-0" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">
          Anomaly Detection (mm/s)
        </span>
        <span
          className="ml-auto text-xs font-display"
          style={{ color: count > 0 ? '#FBBF24' : '#34D399' }}
          title="Readings above the band and above the noise floor, in the selected range."
        >
          {count} {count === 1 ? 'anomaly' : 'anomalies'} in range
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
            formatter={tooltipValueFormatter}
          />
          <Legend wrapperStyle={LEGEND_WRAPPER} />
          {vibWarn != null && (
            <ReferenceLine
              y={vibWarn} stroke="#FBBF24" strokeDasharray="5 4" strokeWidth={1}
              ifOverflow="extendDomain"
              label={{ value: 'Warn', position: 'right', fill: '#FBBF24', fontSize: 10 }}
            />
          )}
          {vibCritical != null && (
            <ReferenceLine
              y={vibCritical} stroke="#F87171" strokeDasharray="5 4" strokeWidth={1}
              ifOverflow="extendDomain"
              label={{ value: 'Critical', position: 'right', fill: '#F87171', fontSize: 10 }}
            />
          )}
          <Line name="Upper band" type="monotone" dataKey="upper" stroke="#7b7b83" strokeDasharray="4 4" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line name="Lower band" type="monotone" dataKey="lower" stroke="#7b7b83" strokeDasharray="4 4" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line name="Peak vibration" type="monotone" dataKey="peak" stroke="#38BDF8" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Scatter name="Anomaly" dataKey="anomaly" fill="#F87171" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(AnomalyChart)
