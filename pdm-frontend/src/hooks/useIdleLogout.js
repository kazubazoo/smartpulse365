import { useCallback, useEffect, useRef, useState } from 'react'

// Warn this long before signing out, so an operator who is reading rather than
// clicking gets a chance to stay in instead of losing the screen mid-thought.
export const IDLE_WARNING_MS = 60_000

// Activity is deliberately limited to things a person does. The dashboard polls
// the API every second, so counting network or timer work as activity would
// keep a session alive forever on an unattended terminal — which is the exact
// risk the timeout exists to cover.
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'wheel', 'scroll']

// Shared across tabs: working in one tab must not let another tab's timer expire
// and sign the whole browser out from underneath it.
const LAST_ACTIVITY_KEY = 'pdm.lastActivity.v1'

function readSharedActivity() {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeSharedActivity(at) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at))
  } catch { /* private mode — the in-tab timer still works */ }
}

/** Sign the user out after a period with no human input.
 *
 * `timeoutMs` of 0 disables the timer entirely.
 * Returns the warning state so the caller can render a countdown.
 */
export function useIdleLogout({ enabled, timeoutMs, onTimeout }) {
  const [msLeft, setMsLeft] = useState(null)   // non-null once the warning is up
  // Clocks are read inside effects and handlers, never during render.
  const lastActivity = useRef(0)
  const warningShown = useRef(false)
  const onTimeoutRef = useRef(onTimeout)
  const firedRef = useRef(false)

  useEffect(() => { onTimeoutRef.current = onTimeout }, [onTimeout])

  const markActive = useCallback(() => {
    const now = Date.now()
    lastActivity.current = now
    warningShown.current = false
    writeSharedActivity(now)
    setMsLeft(null)
  }, [])

  const active = enabled && timeoutMs > 0

  useEffect(() => {
    if (!active) return

    firedRef.current = false
    warningShown.current = false
    lastActivity.current = Math.max(Date.now(), readSharedActivity())

    const onActivity = () => {
      // While the warning is up, ordinary activity must not silently cancel it
      // — the operator has to answer the prompt, or they would never learn the
      // session was about to end.
      if (warningShown.current) return
      markActive()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true })
    }

    const onStorage = (e) => {
      if (e.key !== LAST_ACTIVITY_KEY || !e.newValue) return
      const at = Number(e.newValue)
      if (Number.isFinite(at) && at > lastActivity.current && !warningShown.current) {
        lastActivity.current = at
        setMsLeft(null)
      }
    }
    window.addEventListener('storage', onStorage)

    const tick = setInterval(() => {
      const remaining = timeoutMs - (Date.now() - lastActivity.current)

      if (remaining <= 0) {
        if (firedRef.current) return
        firedRef.current = true
        warningShown.current = false
        setMsLeft(null)
        onTimeoutRef.current?.()
        return
      }

      const warn = remaining <= IDLE_WARNING_MS
      warningShown.current = warn
      setMsLeft(warn ? remaining : null)
    }, 1000)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity)
      }
      window.removeEventListener('storage', onStorage)
      clearInterval(tick)
    }
  }, [active, timeoutMs, markActive])

  // Derived rather than cleared in an effect: with the timer off there is no
  // warning to show, whatever the last tick happened to leave behind.
  return { msLeft: active ? msLeft : null, stayActive: markActive }
}
