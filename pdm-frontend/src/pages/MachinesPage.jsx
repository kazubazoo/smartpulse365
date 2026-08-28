import { useState } from 'react'
import { useMachines, EMPTY_SOURCE } from '../contexts/machinesStore'
import { apiPost } from '../lib/api'

const INPUT_CLASS =
  'bg-bg-deep border border-border-glow rounded-lg px-3 py-2 text-sm ' +
  'text-slate-200 outline-none focus:border-accent-cyan w-full'

const BLANK = {
  id: '', name: '', location: '', notes: '',
  source: { ...EMPTY_SOURCE },
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-600 leading-snug">{hint}</span>}
    </label>
  )
}

function MachineForm({ initial, isNew, onSave, onCancel, onDelete }) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)
  const [probe, setProbe] = useState(null)

  async function testConnection() {
    setTesting(true); setProbe(null)
    try {
      setProbe(await apiPost('/api/connectivity/test', draft.source ?? {}))
    } catch (err) {
      setProbe({ reachable: false, responded: false, detail: err.message })
    }
    setTesting(false)
  }

  const set = (patch) => setDraft(d => ({ ...d, ...patch }))
  const setSource = (patch) => setDraft(d => ({ ...d, source: { ...d.source, ...patch } }))

  async function submit(e) {
    e.preventDefault()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(draft.id.trim())) {
      setError('Machine ID must be letters, numbers, hyphen or underscore only.')
      return
    }
    setBusy(true); setError(null)
    const { error } = await onSave(draft)
    setBusy(false)
    if (error) setError(error.message)
    else onCancel()
  }

  return (
    <form
      onSubmit={submit}
      className="bg-bg-panel border border-accent-cyan/30 rounded-xl p-5 mb-5"
    >
      <h2 className="font-display text-slate-200 text-lg mb-4">
        {isNew ? 'Add machine' : `Edit ${initial.name || initial.id}`}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Field
          label="Machine ID"
          hint={isNew
            ? 'Must match the machine_id tag the acquisition flow writes. Cannot be changed later.'
            : 'Fixed — it links this machine to its stored telemetry.'}
        >
          <input
            className={INPUT_CLASS} value={draft.id} required disabled={!isNew}
            onChange={e => set({ id: e.target.value })}
            placeholder="motor05"
          />
        </Field>

        <Field label="Display name">
          <input
            className={INPUT_CLASS} value={draft.name} required
            onChange={e => set({ name: e.target.value })}
            placeholder="Conveyor Motor 05"
          />
        </Field>

        <Field label="Location">
          <input
            className={INPUT_CLASS} value={draft.location ?? ''}
            onChange={e => set({ location: e.target.value })}
            placeholder="Line 2, Bay 4"
          />
        </Field>

        <Field label="Notes">
          <input
            className={INPUT_CLASS} value={draft.notes ?? ''}
            onChange={e => set({ notes: e.target.value })}
            placeholder="5.5 kW, replaced bearings Mar 2026"
          />
        </Field>
      </div>

      <div className="border-t border-border-glow pt-4">
        <h3 className="text-xs tracking-widest uppercase text-slate-400 mb-1">
          Data source
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          How the acquisition layer reaches this machine. Recorded here as the
          authoritative definition; enter the same values in the Node-RED flow
          so the readings arrive tagged with the Machine ID above.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Protocol">
            <select
              className={`${INPUT_CLASS} cursor-pointer`}
              value={draft.source?.protocol ?? 'modbus-tcp'}
              onChange={e => setSource({ protocol: e.target.value })}
            >
              <option value="modbus-tcp">Modbus TCP</option>
              <option value="modbus-rtu">Modbus RTU</option>
              <option value="opc-ua">OPC UA</option>
              <option value="mqtt">MQTT</option>
            </select>
          </Field>

          <Field label="Host / address">
            <input
              className={INPUT_CLASS} value={draft.source?.host ?? ''}
              onChange={e => setSource({ host: e.target.value })}
              placeholder="192.168.0.30"
            />
          </Field>

          <Field label="Port">
            <input
              type="number" className={INPUT_CLASS} value={draft.source?.port ?? 502}
              onChange={e => setSource({ port: Number(e.target.value) })}
            />
          </Field>

          <Field label="Unit / slave ID">
            <input
              type="number" className={INPUT_CLASS} value={draft.source?.unit_id ?? 1}
              onChange={e => setSource({ unit_id: Number(e.target.value) })}
            />
          </Field>

          <Field label="Poll interval" hint="Milliseconds between reads.">
            <input
              type="number" step={100} className={INPUT_CLASS}
              value={draft.source?.poll_ms ?? 1000}
              onChange={e => setSource({ poll_ms: Number(e.target.value) })}
            />
          </Field>

          <Field label="Measurement" hint="InfluxDB measurement the readings land in.">
            <input
              className={INPUT_CLASS} value={draft.source?.measurement ?? 'motor_metrics'}
              onChange={e => setSource({ measurement: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-4 flex items-start gap-3 flex-wrap">
          <button
            type="button" onClick={testConnection}
            disabled={testing || !draft.source?.host}
            className="text-sm text-slate-200 border border-border-glow rounded-lg px-4 py-2 hover:border-accent-cyan/50 disabled:opacity-40 transition-colors"
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>

          {probe && (
            <div
              className={`flex-1 min-w-[16rem] rounded-lg px-3 py-2 border text-xs ${
                probe.responded
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : probe.reachable
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-red-500/10 border-red-500/30 text-red-200'
              }`}
            >
              <p className="font-body tracking-wide mb-0.5">
                {probe.responded
                  ? 'Connected'
                  : probe.reachable ? 'Reachable, no Modbus reply' : 'Not connected'}
                {probe.target && <span className="opacity-60 ml-2 font-mono">{probe.target}</span>}
              </p>
              <p className="opacity-80">{probe.detail}</p>
              {probe.response_ms !== undefined && (
                <p className="opacity-60 mt-0.5">Replied in {probe.response_ms} ms</p>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400 mt-4">{error}</p>}

      <div className="flex items-center gap-3 mt-5">
        <button
          type="submit" disabled={busy}
          className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-4 py-2 text-sm hover:bg-accent-cyan/20 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Saving…' : isNew ? 'Add machine' : 'Save changes'}
        </button>
        <button
          type="button" onClick={onCancel}
          className="text-sm text-slate-400 border border-border-glow rounded-lg px-4 py-2 hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
        {!isNew && (
          <button
            type="button" onClick={() => onDelete(initial.id)}
            className="ml-auto text-sm text-slate-400 border border-border-glow rounded-lg px-4 py-2 hover:border-red-500/50 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </form>
  )
}

function MachinesPage() {
  const { machines, definitions, registryAvailable, saveMachine, deleteMachine } = useMachines()
  const [editing, setEditing] = useState(null)   // machine id, or '__new__'
  const [confirming, setConfirming] = useState(null)

  if (!registryAvailable) {
    return (
      <div>
        <h1 className="font-display text-slate-50 text-xl mb-4">Machines</h1>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 max-w-2xl">
          <p className="text-sm text-amber-200 mb-2">Machine registry not available</p>
          <p className="text-xs text-slate-400">
            The <span className="font-mono">machines</span> table has not been created yet.
            Run <span className="font-mono">supabase/schema.sql</span> in the Supabase SQL
            Editor, then reload. Until then the dashboard falls back to the machine list
            configured on the server.
          </p>
        </div>
      </div>
    )
  }

  const current = editing === '__new__'
    ? BLANK
    : definitions.find(d => d.id === editing)

  async function onDelete(id) {
    if (confirming !== id) { setConfirming(id); return }
    await deleteMachine(id)
    setConfirming(null)
    setEditing(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-slate-50 text-xl">Machines</h1>
        {!editing && (
          <button
            onClick={() => setEditing('__new__')}
            className="bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-lg px-4 py-2 text-sm hover:bg-accent-cyan/20 transition-colors"
          >
            Add machine
          </button>
        )}
      </div>

      {editing && current && (
        <MachineForm
          key={editing}
          initial={{ ...BLANK, ...current, source: { ...EMPTY_SOURCE, ...(current.source ?? {}) } }}
          isNew={editing === '__new__'}
          onSave={saveMachine}
          onCancel={() => { setEditing(null); setConfirming(null) }}
          onDelete={onDelete}
        />
      )}

      {confirming && (
        <p className="text-xs text-amber-300 mb-4">
          Press Remove again to delete <span className="font-mono">{confirming}</span>.
          Stored telemetry is not deleted.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {machines.map(m => (
          <div
            key={m.id}
            className="bg-bg-panel border border-border-glow rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display text-slate-200">{m.name ?? m.id}</span>
                <span className="font-mono text-[11px] text-slate-600">{m.id}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {m.location || 'No location set'}
                {m.source?.host && <span className="ml-2 font-mono">{m.source.host}:{m.source.port}</span>}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-[11px] tracking-widest uppercase text-slate-500">
                {m.run_state ?? 'OFFLINE'}
              </span>
              <button
                onClick={() => { setEditing(m.id); setConfirming(null) }}
                className="text-xs text-slate-400 border border-border-glow rounded-lg px-3 py-1.5 hover:text-slate-200 transition-colors"
              >
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default MachinesPage
