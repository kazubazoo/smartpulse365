import { createContext, useContext } from 'react'

export const SettingsContext = createContext(null)

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}

export const SETTINGS_STORAGE_KEY = 'pdm.settings.v1'

// Machine tuning carried over from the era when display preferences and alarm
// limits shared one blob. It is kept here until a machine adopts it, so an
// existing operator's hand-set limits are not silently replaced by defaults.
export const LEGACY_MACHINE_KEY = 'pdm.legacyMachineConfig.v1'

export function rememberLegacyMachineConfig(machine) {
  if (!machine) return
  try {
    if (localStorage.getItem(LEGACY_MACHINE_KEY)) return
    localStorage.setItem(LEGACY_MACHINE_KEY, JSON.stringify(machine))
  } catch { /* nothing to do if storage is unavailable */ }
}

export function readLegacyMachineConfig() {
  try {
    const raw = localStorage.getItem(LEGACY_MACHINE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
