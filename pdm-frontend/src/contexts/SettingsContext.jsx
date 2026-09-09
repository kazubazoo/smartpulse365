import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, authConfigured } from '../lib/supabase'
import { useAuth } from './authStore'
import {
  SettingsContext, SETTINGS_STORAGE_KEY as STORAGE_KEY, rememberLegacyMachineConfig,
} from './settingsStore'
import { DEFAULT_UI_SETTINGS, splitLegacySettings } from '../lib/defaults'

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const { ui } = splitLegacySettings(JSON.parse(raw))
    return ui
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
  const [settings, setSettings] = useState(() => readLocal() ?? DEFAULT_UI_SETTINGS)
  const [syncState, setSyncState] = useState('idle') // idle | saving | saved | error
  const loadedFor = useRef(null)
  const savedTimer = useRef(null)
  // Mirror of the current settings for the update callbacks to read. Synced
  // after commit, which is soon enough — update() only ever runs from an event
  // handler, never during render.
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])

  useEffect(() => () => clearTimeout(savedTimer.current), [])

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
          const { ui, machine } = splitLegacySettings(data.settings)
          setSettings(ui)
          writeLocal(ui)
          rememberLegacyMachineConfig(machine)
        }
      })
  }, [user])

  // Writes go out on an explicit action now — a picker change, or Save on the
  // settings page — so there is nothing to debounce and the "Saved" tick is a
  // truthful report of a completed round trip rather than a timer firing.
  const persist = useCallback(async (next) => {
    writeLocal(next)
    if (!authConfigured || !user) return { ok: true }

    setSyncState('saving')
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, settings: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )

    setSyncState(error ? 'error' : 'saved')
    if (error) {
      console.warn('Settings save failed:', error.message)
      return { ok: false, error }
    }
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSyncState('idle'), 2000)
    return { ok: true }
  }, [user])

  // The next value is derived from a ref rather than inside a setState updater:
  // persist() calls setSyncState, and React must not be told to update another
  // piece of state from within an updater function.
  const update = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch }
    setSettings(next)
    return persist(next)
  }, [persist])

  const reset = useCallback(() => {
    setSettings(DEFAULT_UI_SETTINGS)
    return persist(DEFAULT_UI_SETTINGS)
  }, [persist])

  return (
    <SettingsContext.Provider value={{ settings, update, reset, syncState }}>
      {children}
    </SettingsContext.Provider>
  )
}
