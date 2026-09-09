import { memo, useState } from 'react'

// A slider paired with a numeric box. The slider is for finding a value by
// feel; the box is for typing an exact one from a specification sheet. Both
// edit the same number, so neither way is a second-class citizen.
function Slider({
  label, value, onChange, min = 0, max = 100, step = 0.1,
  unit, hint, marks = [], disabled = false, tone = 'cyan',
}) {
  // While the box has focus it holds free text, so a half-entered "4." or a
  // momentarily empty field does not snap back to a number under the cursor.
  // null means "not being edited", and the displayed value is derived from the
  // prop — no effect needed to keep the two in step.
  const [typed, setTyped] = useState(null)
  const text = typed ?? String(value)

  const clamp = (v) => Math.min(max, Math.max(min, v))
  const pct = max > min ? ((clamp(value) - min) / (max - min)) * 100 : 0

  const accent = {
    cyan: 'var(--color-accent-cyan)',
    amber: 'var(--color-status-amber)',
    red: 'var(--color-status-red)',
    green: 'var(--color-status-green)',
  }[tone] ?? 'var(--color-accent-cyan)'

  const commitText = () => {
    const parsed = parseFloat(typed ?? '')
    setTyped(null)
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
  }

  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-slate-300">{label}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            value={text}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            onFocus={() => setTyped(String(value))}
            onChange={e => setTyped(e.target.value)}
            onBlur={commitText}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-20 bg-bg-deep border border-border-glow rounded-md px-2 py-1 text-right text-sm text-slate-100 font-mono outline-none focus:border-accent-cyan"
          />
          {unit && <span className="text-[11px] text-slate-500 w-9">{unit}</span>}
        </div>
      </div>

      <input
        type="range"
        value={clamp(value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="pdm-range w-full"
        style={{ '--pdm-pct': `${pct}%`, '--pdm-accent': accent }}
      />

      {marks.length > 0 && (
        <div className="flex justify-between text-[10px] text-slate-600 font-mono -mt-1">
          {marks.map(m => <span key={m.value}>{m.label}</span>)}
        </div>
      )}

      {hint && <span className="text-[11px] text-slate-500 leading-snug">{hint}</span>}
    </div>
  )
}

export default memo(Slider)
