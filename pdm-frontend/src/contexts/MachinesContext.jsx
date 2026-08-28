import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, authConfigured } from '../lib/supabase'
import { MachinesContext, EMPTY_SOURCE } from './machinesStore'
import { useSettings } from './settingsStore'
import { apiFetch } from '../lib/api'
import { refreshMs, toQuery } from '../lib/defaults'

export function MachinesProvider({ children }) {
  // Definitions: who the machines are, edited in the UI, stored in Supabase.
  const [definitions, setDefinitions] = useState([])
  // Status: what they are doing right now, from the telemetry API.
  const [status, setStatus] = useState([])
  const [loading, setLoading] = useState(true)
  const [registryAvailable, setRegistryAvailable] = useState(false)
  const [error, setError] = useState(null)
  const definitionsRef = useRef(definitions)

  const { settings } = useSettings()
  const interval = refreshMs(settings.refreshId)
  const {
    vibWarn, vibCritical, vibScale, tempWarn, tempCritical,
    sigma, lookback, anomalyFloor,
  } = settings

  useEffect(() => { definitionsRef.current = definitions }, [definitions])

  // Pure fetch, no state writes — so the effect below can do its updating
  // inside a promise callback rather than synchronously in the effect body.
  const fetchDefinitions = useCallback(async () => {
    if (!authConfigured) return { ok: false, rows: [] }

    const { data, error } = await supabase
      .from('machines')
      .select('id,name,location,notes,source')
      .order('name')

    // A missing table is expected before the migration is run; fall back to
    // whatever the API reports so the dashboard still works.
    if (error) return { ok: false, rows: [] }
    return { ok: true, rows: data ?? [] }
  }, [])

  const applyDefinitions = useCallback(({ ok, rows }) => {
    setRegistryAvailable(ok)
    if (ok) setDefinitions(rows)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchDefinitions().then(result => {
      if (!cancelled) applyDefinitions(result)
    })
    return () => { cancelled = true }
  }, [fetchDefinitions, applyDefinitions])

  const loadDefinitions = useCallback(async () => {
    const result = await fetchDefinitions()
    applyDefinitions(result)
    return result.rows
  }, [fetchDefinitions, applyDefinitions])

  const statusQuery = useMemo(() => toQuery({
    vib_warn: vibWarn, vib_critical: vibCritical, vib_scale: vibScale,
    temp_warn: tempWarn, temp_critical: tempCritical,
    sigma, lookback, anomaly_floor: anomalyFloor,
  }), [vibWarn, vibCritical, vibScale, tempWarn, tempCritical,
       sigma, lookback, anomalyFloor])

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      const ids = definitionsRef.current.map(d => d.id).join(',')
      const qs = ids ? `${statusQuery}&ids=${encodeURIComponent(ids)}` : statusQuery
      apiFetch(`/api/machines?${qs}`)
        .then(list => {
          if (cancelled) return
          setStatus(list)
          setLoading(false)
          setError(null)
        })
        .catch(err => {
          if (cancelled) return
          setLoading(false)
          setError(err.message)
        })
    }

    poll()
    const id = setInterval(poll, Math.max(interval || 5000, 5000))
    return () => { cancelled = true; clearInterval(id) }
  }, [statusQuery, interval, definitions])

  // The definition owns identity and display name; the API owns live state.
  const machines = useMemo(() => {
    const byId = new Map(status.map(s => [s.id, s]))
    if (definitions.length === 0) return status

    return definitions.map(def => ({
      ...(byId.get(def.id) ?? {
        id: def.id, online: false, run_state: 'OFFLINE', anomaly_count: 0,
      }),
      ...def,
    }))
  }, [definitions, status])

  const saveMachine = useCallback(async (machine) => {
    const row = {
      id: machine.id.trim(),
      name: machine.name.trim() || machine.id.trim(),
      location: machine.location ?? '',
      notes: machine.notes ?? '',
      source: machine.source ?? EMPTY_SOURCE,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('machines').upsert(row, { onConflict: 'id' })
    if (error) return { error }
    await loadDefinitions()
    return {}
  }, [loadDefinitions])

  const deleteMachine = useCallback(async (id) => {
    const { error } = await supabase.from('machines').delete().eq('id', id)
    if (error) return { error }
    await loadDefinitions()
    return {}
  }, [loadDefinitions])

  return (
    <MachinesContext.Provider value={{
      machines, definitions, loading, error, registryAvailable,
      saveMachine, deleteMachine, reloadMachines: loadDefinitions,
    }}>
      {children}
    </MachinesContext.Provider>
  )
}
