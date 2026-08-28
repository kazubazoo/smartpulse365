import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, authConfigured } from '../lib/supabase'
import { useAuth } from './authStore'
import { SettingsContext } from './settingsStore'
import { DEFAULT_SETTINGS } from '../lib/defaults'

const STORAGE_KEY = 'pdm.settings.v1'
function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return null
  }
}

function writeLocal(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* private mode or quota — the in-memory copy still works this session */
  }
}

export function SettingsProvider({ children }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(() => readLocal() ?? DEFAULT_SETTINGS)
  const [syncState, setSyncState] = useState('idle') // idle | saving | saved | error
  const saveTimer = useRef(null)
  const loadedFor = useRef(null)
  // Mirror of the current settings for the update callbacks to read. Synced
  // after commit, which is soon enough — update() only ever runs from an event
  // handler, never during render.
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  // Pull the signed-in user's stored settings once per session. Local values
  // are kept if the row doesn't exist yet, and are then pushed up on first save.
  useEffect(() => {
    if (!authConfigured || !user || loadedFor.current === user.id) return
    loadedFor.current = user.id

    supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn('Settings load failed, using local copy:', error.message)
          return
        }
        if (data?.settings) {
          const merged = { ...DEFAULT_SETTINGS, ...data.settings }
          setSettings(merged)
          writeLocal(merged)
        }
      })
  }, [user])

  // Debounced write-behind: localStorage immediately, Supabase after a pause so
  // dragging a threshold input doesn't fire a request per keystroke.
  const persist = useCallback((next) => {
    writeLocal(next)
    if (!authConfigured || !user) return

    setSyncState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from('user_settings')
        .upsert(
          { user_id: user.id, settings: next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
      setSyncState(error ? 'error' : 'saved')
      if (error) console.warn('Settings save failed:', error.message)
      else setTimeout(() => setSyncState('idle'), 1500)
    }, 600)
  }, [user])

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // The next value is derived from a ref rather than inside a setState updater:
  // persist() calls setSyncState, and React must not be told to update another
  // piece of state from within an updater function.
  const update = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch }
    setSettings(next)
    persist(next)
  }, [persist])

  const updateGauge = useCallback((key, value) => {
    const prev = settingsRef.current
    const next = { ...prev, gauges: { ...prev.gauges, [key]: value } }
    setSettings(next)
    persist(next)
  }, [persist])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    persist(DEFAULT_SETTINGS)
  }, [persist])

  return (
    <SettingsContext.Provider value={{ settings, update, updateGauge, reset, syncState }}>
      {children}
    </SettingsContext.Provider>
  )
}

