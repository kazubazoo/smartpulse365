import { useEffect, useState } from 'react'
import { supabase, authConfigured } from '../lib/supabase'
import { AuthContext } from './authStore'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(authConfigured)
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

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    authConfigured,
    signIn: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) =>
      supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut(),
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

