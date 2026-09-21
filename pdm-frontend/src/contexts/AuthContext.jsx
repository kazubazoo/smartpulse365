import { useEffect, useState } from 'react'
import { supabase, authConfigured, fetchAuthSettings } from '../lib/supabase'
import { AuthContext } from './authStore'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(authConfigured)
  // Whether self-registration is open, read from the project rather than
  // assumed. Null until the answer arrives; the login screen shows no
  // registration option until it does, so the gate fails closed.
  const [authSettings, setAuthSettings] = useState(null)
  // True while the user is here from a password-reset email and still needs to
  // choose a new password. Supabase signs them in first, so without this flag
  // they would land straight on the dashboard and never set one.
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!authConfigured) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    // Fires on login, logout, and silent token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // setState lands in the promise callback, never in the effect body.
  useEffect(() => {
    if (!authConfigured) return
    let cancelled = false
    fetchAuthSettings().then(s => { if (!cancelled) setAuthSettings(s) })
    return () => { cancelled = true }
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    authConfigured,
    signIn: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }),
    // Where the confirmation link lands, when the project requires one.
    signUp: (email, password) =>
      supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      }),
    signOut: () => supabase.auth.signOut(),
    signUpEnabled: authSettings?.signUpEnabled ?? false,
    emailConfirmationRequired: authSettings?.emailConfirmationRequired ?? true,
    recovering,
    // Supabase sends the user back here with a recovery token in the URL.
    resetPassword: (email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      }),
    updatePassword: async (password) => {
      const result = await supabase.auth.updateUser({ password })
      if (!result.error) setRecovering(false)
      return result
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

