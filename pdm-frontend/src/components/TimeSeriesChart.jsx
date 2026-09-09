import { memo, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  GRID, AXIS_TICK, TOOLTIP_CONTENT, TOOLTIP_LABEL, LEGEND_WRAPPER,
  AXIS_STROKE, decimate, tooltipValueFormatter,
} from '../utils/chartConfig'
import { axisFormatter, tooltipFormatter, timeTicks } from '../utils/time'

const DEFAULT_MAX_POINTS = 1500

function TimeSeriesChart({
  title, data, series, dualAxis = false, showLegend = false,
  maxPoints = DEFAULT_MAX_POINTS, refLines,
  windowSeconds, domainFrom, domainTo,
}) {
  // Charts carrying alarm lines are scaled to the alarm by default, so a
  // reading is always seen relative to the limit that matters. "Fit" is opt-in
  // and labelled, because a chart auto-scaled to a quiet signal looks alarming
  // when it is in fact fine — operators read the shape of a trace long before
  // they read the axis numbers.
  const [fit, setFit] = useState(false)
  const scalable = !dualAxis && refLines?.length > 0

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

  const fitted = scalable && fit

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</span>

        {scalable && (
          <div className="ml-auto flex items-center gap-2">
            {fitted && (
              <span
                className="text-[10px] text-status-amber border border-status-amber/40 rounded px-1.5 py-0.5"
                title="The axis is fitted to the data, not to the alarm limits. Small variation will look large."
              >
                zoomed
              </span>
            )}
            <div className="flex bg-bg-deep border border-border-glow rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setFit(false)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  !fitted ? 'bg-accent-blue text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Scale the axis to the alarm limits, so severity is read honestly."
              >
                Alarm
              </button>
              <button
                type="button"
                onClick={() => setFit(true)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                  fitted ? 'bg-accent-blue text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Scale the axis to the data, to inspect fine structure in a quiet signal."
              >
                Fit
              </button>
            </div>
          </div>
        )}
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
            <YAxis
              stroke={fitted ? '#FBBF24' : AXIS_STROKE}
              tick={AXIS_TICK}
              // Fitted charts get a little headroom and a sensible tick count
              // rather than clamping exactly to min/max.
              domain={fitted ? ['auto', 'auto'] : undefined}
            />
          )}
          <Tooltip
            contentStyle={TOOLTIP_CONTENT}
            labelStyle={TOOLTIP_LABEL}
            labelFormatter={tooltipFormatter}
            formatter={tooltipValueFormatter}
          />
          {showLegend && <Legend wrapperStyle={LEGEND_WRAPPER} />}

          {!dualAxis && refLines?.map(rl => (
            <ReferenceLine
              key={rl.label}
              y={rl.y}
              stroke={rl.color}
              strokeDasharray="5 4"
              strokeWidth={1}
              // Alarm scale: the line pulls the axis open so the limit is always
              // on screen. Fit: the line is dropped rather than dragging the
              // axis back out, which is the whole point of fitting.
              ifOverflow={fitted ? 'hidden' : 'extendDomain'}
              label={{ value: rl.label, position: 'right', fill: rl.color, fontSize: 10 }}
            />
          ))}

          {series.map(s => (
            <Line
              key={s.name}
              {...(dualAxis ? { yAxisId: s.axis } : {})}
              // Diagnosis codes hold a value until the sensor reports a
              // different one; sloping between two codes would draw values the
              // sensor never emitted.
              type={s.step ? 'stepAfter' : 'monotone'}
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
