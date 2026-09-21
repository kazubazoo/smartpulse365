import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Auth is optional so the module still runs on an isolated plant network with
// no Supabase project configured. When these are absent the dashboard skips
// the login gate and keeps settings in localStorage only.
export const authConfigured = Boolean(url && anonKey)

export const supabase = authConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

/** The project's public auth configuration.
 *
 * Whether operators may register themselves, and whether a new account has to
 * confirm its email first, are decided in the Supabase dashboard — not here.
 * Reading them back means the login screen matches the project it is pointed
 * at: an invite-only deployment never shows a Create account tab that could
 * only fail, and turning sign-ups on takes effect without rebuilding the
 * frontend. The endpoint is public and the anon key is the intended caller.
 *
 * Returns null if it cannot be reached; callers treat that as "sign-up off",
 * because failing closed is the safe direction for a registration gate.
 */
export async function fetchAuthSettings() {
  if (!authConfigured) return null
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })
    if (!res.ok) return null
    const settings = await res.json()
    return {
      signUpEnabled: settings.disable_signup === false,
      // mailer_autoconfirm true means Supabase skips the confirmation email and
      // the new account is signed in straight away.
      emailConfirmationRequired: settings.mailer_autoconfirm === false,
    }
  } catch {
    return null
  }
}
