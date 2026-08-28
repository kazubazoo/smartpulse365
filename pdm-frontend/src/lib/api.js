import { supabase, authConfigured } from './supabase'

// Single fetch wrapper so every request carries the Supabase access token when
// auth is configured. The backend enforces it only if it too has SUPABASE_URL
// set, which keeps the pair loosely coupled during setup.
export async function apiFetch(path, { signal } = {}) {
  const headers = {}

  if (authConfigured) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(path, { headers, signal })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} on ${path}`)
  }
  return res.json()
}

export async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' }

  if (authConfigured) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.detail ?? `${res.status} ${res.statusText}`)
  return json
}
