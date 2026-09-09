import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, authConfigured } from '../lib/supabase'
import { MachinesContext, EMPTY_SOURCE } from './machinesStore'
import { useSettings, readLegacyMachineConfig } from './settingsStore'
import { apiFetch } from '../lib/api'
import {
  refreshMs, toQuery, effectiveMachineConfig, pickMachineConfig,
  DEFAULT_MACHINE_CONFIG,
} from '../lib/defaults'

// Columns to request. `thresholds` is newer than the rest, so a registry that
// predates it must still load — see the retry in fetchDefinitions.
const COLUMNS_WITH_THRESHOLDS = 'id,name,location,notes,source,thresholds'
const COLUMNS_LEGACY = 'id,name,location,notes,source'

export function MachinesProvider({ children }) {
  // Definitions: who the machines are, edited in the UI, stored in Supabase.
  const [definitions, setDefinitions] = useState([])
  // Status: what they are doing right now, from the telemetry API.
  const [status, setStatus] = useState([])
  const [loading, setLoading] = useState(true)
  const [registryAvailable, setRegistryAvailable] = useState(false)
  const [thresholdsColumn, setThresholdsColumn] = useState(true)
  const [error, setError] = useState(null)
  const definitionsRef = useRef(definitions)

  const { settings } = useSettings()
  const interval = refreshMs(settings.refreshId)

  useEffect(() => { definitionsRef.current = definitions }, [definitions])

  // Pure fetch, no state writes — so the effect below can do its updating
  // inside a promise callback rather than synchronously in the effect body.
  const fetchDefinitions = useCallback(async () => {
    if (!authConfigured) return { ok: false, rows: [], hasThresholds: false }

    let { data, error } = await supabase
      .from('machines')
      .select(COLUMNS_WITH_THRESHOLDS)
      .order('name')

    // The thresholds column arrived with the per-machine standards feature. A
    // registry created before that still works; it just has no stored config.
    if (error) {
      const retry = await supabase.from('machines').select(COLUMNS_LEGACY).order('name')
      if (retry.error) return { ok: false, rows: [], hasThresholds: false }
      return { ok: true, rows: retry.data ?? [], hasThresholds: false }
    }
    return { ok: true, rows: data ?? [], hasThresholds: true }
  }, [])

  const applyDefinitions = useCallback(({ ok, rows, hasThresholds }) => {
    setRegistryAvailable(ok)
    setThresholdsColumn(hasThresholds)
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

  // A machine with no stored configuration inherits whatever tuning the
  // operator had before limits became per-machine, so upgrading does not
  // silently reset anyone's alarm points back to the shipped defaults.
  const legacyFallback = useMemo(() => readLegacyMachineConfig(), [])

  // Two views of the same thing. `stored` is exactly what is in the database,
  // used by the settings form so a save round-trips to something identical.
  // `effective` folds in the limits the standard implies, and is what the API
  // is actually called with.
  const storedById = useMemo(() => {
    const map = new Map()
    for (const def of definitions) {
      const raw = def.thresholds && Object.keys(def.thresholds).length
        ? def.thresholds
        : legacyFallback
      map.set(def.id, pickMachineConfig(raw))
    }
    return map
  }, [definitions, legacyFallback])

  const configById = useMemo(() => {
    const map = new Map()
    for (const [id, stored] of storedById) map.set(id, effectiveMachineConfig(stored))
    return map
  }, [storedById])

  const configFor = useCallback(
    (id) => configById.get(id) ?? effectiveMachineConfig(legacyFallback),
    [configById, legacyFallback],
  )

  const storedConfigFor = useCallback(
    (id) => storedById.get(id) ?? pickMachineConfig(legacyFallback),
    [storedById, legacyFallback],
  )

  // Fleet scoring uses each machine's own limits. The query-level thresholds
  // stay as the fallback for any machine the map does not cover.
  const fallbackConfig = useMemo(
    () => effectiveMachineConfig(legacyFallback),
    [legacyFallback],
  )

  const statusQuery = useMemo(() => {
    const f = fallbackConfig
    return toQuery({
      vib_warn: f.vibWarn, vib_critical: f.vibCritical, vib_scale: f.vibScale,
      temp_warn: f.tempWarn, temp_critical: f.tempCritical,
      sigma: f.sigma, lookback: f.lookback, anomaly_floor: f.anomalyFloor,
    })
  }, [fallbackConfig])

  const limitsParam = useMemo(() => (
    [...configById.entries()]
      .map(([id, c]) => [
        id, c.vibWarn, c.vibCritical, c.vibScale, c.tempWarn, c.tempCritical,
      ].join(':'))
      .join(',')
  ), [configById])

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      const ids = definitionsRef.current.map(d => d.id).join(',')
      const parts = [statusQuery]
      if (ids) parts.push(`ids=${encodeURIComponent(ids)}`)
      if (limitsParam) parts.push(`limits=${encodeURIComponent(limitsParam)}`)
      apiFetch(`/api/machines?${parts.join('&')}`)
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
  }, [statusQuery, limitsParam, interval, definitions])

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
    if (thresholdsColumn) row.thresholds = machine.thresholds ?? {}
    const { error } = await supabase.from('machines').upsert(row, { onConflict: 'id' })
    if (error) return { error }
    await loadDefinitions()
    return {}
  }, [loadDefinitions, thresholdsColumn])

  // Only the analytic configuration, so saving limits from the Settings page
  // cannot disturb the machine's identity or its acquisition details.
  const saveMachineConfig = useCallback(async (id, config) => {
    if (!thresholdsColumn) {
      return { error: { message: 'Run supabase/schema.sql to add the thresholds column.' } }
    }
    // Only the storable shape: derived limits are recomputed on read, and
    // writing them back is what used to leave the Save bar stuck open.
    const { error } = await supabase
      .from('machines')
      .update({ thresholds: pickMachineConfig(config), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { error }
    await loadDefinitions()
    return {}
  }, [loadDefinitions, thresholdsColumn])

  const deleteMachine = useCallback(async (id) => {
    const { error } = await supabase.from('machines').delete().eq('id', id)
    if (error) return { error }
    await loadDefinitions()
    return {}
  }, [loadDefinitions])

  return (
    <MachinesContext.Provider value={{
      machines, definitions, loading, error, registryAvailable, thresholdsColumn,
      configFor, storedConfigFor, defaultConfig: DEFAULT_MACHINE_CONFIG,
      saveMachine, saveMachineConfig, deleteMachine, reloadMachines: loadDefinitions,
    }}>
      {children}
    </MachinesContext.Provider>
  )
}
