import { createContext, useContext } from 'react'

// Context object and its hook live apart from the provider component so the
// provider file exports components only (React Fast Refresh requirement).
export const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
