import { memo, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  GRID, AXIS_TICK, TOOLTIP_CONTENT, TOOLTIP_LABEL, LEGEND_WRAPPER,
  AXIS_STROKE, decimate,
} from '../utils/chartConfig'
import { axisFormatter, tooltipFormatter, timeTicks } from '../utils/time'

const DEFAULT_MAX_POINTS = 1500

function TimeSeriesChart({
  title, data, series, dualAxis = false, showLegend = false,
  maxPoints = DEFAULT_MAX_POINTS, refLines,
  windowSeconds, domainFrom, domainTo,
}) {
  const formatted = useMemo(() => {
    const reduced = decimate(data, maxPoints, series[0].field)
    return reduced.map(r => {
      const row = { t: r.t }
      for (const s of series) row[s.name] = s.derive ? s.derive(r) : r[s.field]
      return row
    })
  }, [data, series, maxPoints])

  // A real time scale with an explicit domain, so the axis always covers the
  // selected range. A gap in the data then reads as a gap, instead of the chart
  // silently rescaling to whatever happens to exist.
  const domain = useMemo(() => [domainFrom, domainTo], [domainFrom, domainTo])
  const ticks = useMemo(() => timeTicks(domainFrom, domainTo), [domainFrom, domainTo])
  const tickFormat = useMemo(() => axisFormatter(windowSeconds), [windowSeconds])

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={formatted}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="t"
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={tickFormat}
            stroke={AXIS_STROKE}
            tick={AXIS_TICK}
            minTickGap={50}
          />
          {dualAxis ? (
            <>
              <YAxis yAxisId="left" stroke="#38BDF8" tick={AXIS_TICK} />
              <YAxis yAxisId="right" orientation="right" stroke="#34D399" tick={AXIS_TICK} />
            </>
          ) : (
            <YAxis stroke={AXIS_STROKE} tick={AXIS_TICK} />
          )}
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
            labelFormatter={tooltipFormatter}
          />
          {showLegend && <Legend wrapperStyle={LEGEND_WRAPPER} />}

          {!dualAxis && refLines?.map(rl => (
            <ReferenceLine
              key={rl.label}
              y={rl.y}
              stroke={rl.color}
              strokeDasharray="5 4"
              strokeWidth={1}
              ifOverflow="extendDomain"
              label={{ value: rl.label, position: 'right', fill: rl.color, fontSize: 10 }}
            />
          ))}

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
              // A missing sample is a hole in the record, not a straight line
              // between the readings either side of it.
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(TimeSeriesChart)
