import { memo, useMemo } from 'react'
import { axisFormatter, tooltipFormatter, timeTicks } from '../utils/time'

// Per-axis fault diagnosis codes are categorical state, not magnitude, so they
// are drawn as a state timeline rather than a chart with a numeric Y axis.
//
// A line chart was actively misleading here for two reasons. A numeric axis
// invites reading code 20 as "twice" code 10, when they are unrelated
// diagnoses. And with three axes plotted against one axis, the two reporting
// code 0 are hidden underneath the third — an operator sees one line and cannot
// tell whether the other two are healthy or simply not drawn.
//
// One lane per axis fixes both: every axis is always visible, and colour
// carries the code with no implication of ordering or distance.

const MAX_SEGMENTS = 300

// Code 0 means "no fault reported". It is the normal state and is deliberately
// muted, so it never competes for attention with a real code.
const NO_FAULT_COLOR = '#17304D'
const CODE_COLORS = ['#FBBF24', '#FB923C', '#F87171', '#C084FC', '#38BDF8', '#A3E635']

// Hatched lane background. Segments paint over it, so anything still showing
// the hatch is time with no reading at all — unmistakably different from code
// 0, which is the sensor actively reporting "no fault". Module scope: an inline
// style object would be a new identity on every render.
const HATCH = {
  background: 'repeating-linear-gradient(45deg, #0B1626 0 5px, #15283F 5px 10px)',
}

// Four labels rather than six: these carry seconds and am/pm, and the panel sits
// half-width beside the temperature chart.
const TICK_COUNT = 4

function formatDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

// The typical gap between samples, used both to give a lone sample a visible
// width and to decide what counts as missing data. The median is taken rather
// than the mean so one long gap does not drag the estimate out.
function sampleInterval(rows) {
  if (rows.length < 2) return 1000
  const gaps = []
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i].t - rows[i - 1].t)
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] || 1000
}

// Consecutive samples reporting the same code collapse into one segment. This
// is what makes a code held for an hour read as a single band instead of 3600
// indistinguishable points, and it is why no decimation is needed here.
//
// A run is broken when the samples either side are further apart than a missing
// reading would be: the lane is then left blank, because a gap in the record is
// not evidence that the previous code was still active.
function buildSegments(rows, field, step) {
  const gapLimit = step * 2.5
  const segments = []
  let current = null
  let prevT = null

  for (const row of rows) {
    const code = row[field]
    if (code === null || code === undefined || !Number.isFinite(code)) {
      current = null
      prevT = row.t
      continue
    }
    const afterGap = prevT !== null && row.t - prevT > gapLimit
    if (current && !afterGap && current.code === code) {
      current.end = row.t
    } else {
      current = { code, start: row.t, end: row.t }
      segments.push(current)
    }
    prevT = row.t
  }
  return segments
}

// How far each segment is drawn.
//
// A segment is painted up to where the *next* one begins, not to its own last
// sample plus one interval. Sample timing jitters by tens of milliseconds, so
// the latter left a sliver of bare track between every pair of segments — thin
// dark lines that read as missing data when nothing was missing at all.
//
// A real gap is still a gap: when the next segment starts further away than a
// dropped reading would explain, the segment stops after its own duration and
// the hatch shows through for the rest.
function addDrawEnds(segments, step, to) {
  const gapLimit = step * 2.5
  return segments.map((seg, i) => {
    const next = segments[i + 1]
    const continues = next && next.start - seg.end <= gapLimit
    const end = continues ? next.start : seg.end + step
    return { ...seg, drawEnd: Math.min(end, to) }
  })
}

// A pathological window — a code changing on almost every sample — would other-
// wise put thousands of nodes in the DOM. Equal time slices are taken and the
// highest code in each wins, the same MAX-not-average rule the backend uses
// when it buckets these codes: a fault that occurred stays visible.
function condense(segments, from, to) {
  if (segments.length <= MAX_SEGMENTS) return segments
  const width = (to - from) / MAX_SEGMENTS
  const out = []
  for (const seg of segments) {
    const slice = Math.floor((seg.start - from) / width)
    const last = out[out.length - 1]
    if (last && last.slice === slice) {
      last.end = Math.max(last.end, seg.end)
      if (seg.code > last.code) last.code = seg.code
    } else {
      out.push({ ...seg, slice })
    }
  }
  return out
}

function FaultCodeTimeline({
  title, data, series, windowSeconds, domainFrom, domainTo, note,
}) {
  const span = domainTo - domainFrom

  const step = useMemo(() => sampleInterval(data), [data])

  const lanes = useMemo(() => series.map(s => ({
    name: s.name,
    segments: addDrawEnds(
      condense(buildSegments(data, s.field, step), domainFrom, domainTo),
      step, domainTo,
    ),
  })), [data, series, step, domainFrom, domainTo])

  // Codes are coloured by order of first appearance, so the palette is stable
  // for a given window instead of shifting as values come and go.
  const codeOrder = useMemo(() => {
    const seen = []
    for (const lane of lanes) {
      for (const seg of lane.segments) {
        if (seg.code !== 0 && !seen.includes(seg.code)) seen.push(seg.code)
      }
    }
    return seen.sort((a, b) => a - b)
  }, [lanes])

  const ticks = useMemo(
    () => timeTicks(domainFrom, domainTo, TICK_COUNT), [domainFrom, domainTo])
  const tickFormat = useMemo(() => axisFormatter(windowSeconds), [windowSeconds])

  const hasAnything = lanes.some(l => l.segments.length > 0)

  return (
    <div className="bg-bg-panel border border-border-glow rounded-xl p-4 h-full flex flex-col">
      {/* Wraps as a whole: at narrow widths the legend drops onto its own line
          instead of running past the edge of the panel. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse shrink-0" />
        <span className="font-body text-xs tracking-widest uppercase text-slate-100">{title}</span>

        {codeOrder.length > 0 && (
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {codeOrder.map((code, i) => (
              <span key={code} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: CODE_COLORS[i % CODE_COLORS.length] }}
                />
                Code {code}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: NO_FAULT_COLOR }} />
              No fault
            </span>
          </div>
        )}
      </div>

      {hasAnything ? (
        <div className="flex-1 flex flex-col justify-center">
          {lanes.map(lane => (
            <div key={lane.name} className="flex items-center gap-3 mb-1.5 min-w-0">
              <span className="w-6 shrink-0 text-right text-[11px] text-slate-400">{lane.name}</span>
              {/* The track is hatched, and segments are painted over it. Any
                  stretch left showing the hatch is therefore time with no
                  reading at all — visibly different from code 0, which is a
                  sensor actively reporting "no fault". */}
              <div className="relative flex-1 min-w-0 h-6 rounded overflow-hidden" style={HATCH}>
                {lane.segments.map(seg => {
                  // Clamped to the panel: a reading timestamped a moment beyond
                  // the selected window must not paint past the track's edge.
                  const left = Math.min(100, Math.max(0, ((seg.start - domainFrom) / span) * 100))
                  const raw = ((seg.drawEnd - seg.start) / span) * 100
                  const width = Math.max(0.15, Math.min(raw, 100 - left))
                  const color = seg.code === 0
                    ? NO_FAULT_COLOR
                    : CODE_COLORS[Math.max(0, codeOrder.indexOf(seg.code)) % CODE_COLORS.length]
                  return (
                    <div
                      key={`${seg.start}-${seg.code}`}
                      className="absolute top-0 h-full"
                      style={{ left: `${left}%`, width: `${width}%`, background: color }}
                      title={
                        `${lane.name} axis — code ${seg.code}\n` +
                        `${tooltipFormatter(seg.start)} for ${formatDuration(seg.drawEnd - seg.start)}`
                      }
                    />
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3 mt-1 min-w-0">
            <span className="w-6 shrink-0" />
            <div className="relative flex-1 min-w-0 h-4 overflow-hidden">
              {ticks.map((t, i) => {
                // The outermost labels are anchored to the ends rather than
                // centred, which would hang them off the edge of the panel.
                const first = i === 0
                const last = i === ticks.length - 1
                return (
                  <span
                    key={t}
                    className={`absolute text-[10px] text-slate-500 whitespace-nowrap ${
                      first ? '' : last ? '-translate-x-full' : '-translate-x-1/2'
                    }`}
                    style={{ left: `${((t - domainFrom) / span) * 100}%` }}
                  >
                    {tickFormat(t)}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-[104px] flex items-center justify-center text-xs text-slate-500">
          No diagnosis codes reported in this window.
        </div>
      )}

      {note && <p className="mt-3 text-[10px] text-slate-500">{note}</p>}
    </div>
  )
}

export default memo(FaultCodeTimeline)
