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
