import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import IdleWarning from './components/IdleWarning'
import OverviewPage from './pages/OverviewPage'
import DiagnosticsPage from './pages/DiagnosticsPage'
import SettingsPage from './pages/SettingsPage'
import MachinesPage from './pages/MachinesPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import UpdatePasswordPage from './pages/UpdatePasswordPage'
import { AuthProvider } from './contexts/AuthContext'
import { SettingsProvider } from './contexts/SettingsContext'
import { MachinesProvider } from './contexts/MachinesContext'
import { useAuth } from './contexts/authStore'
import { useSettings } from './contexts/settingsStore'
import { useMachines } from './contexts/machinesStore'
import { useIdleLogout } from './hooks/useIdleLogout'
import { idleTimeoutMs } from './lib/defaults'
import './index.css'

const PAGES = ['overview', 'diagnostics', 'machines', 'settings', 'profile']

// The location hash is the source of truth for what is on screen, so a reload
// lands where the operator was instead of bouncing back to the Overview. It
// also makes Back work and makes a view worth pasting into a message.
function parseHash() {
  const [, page, machine] = window.location.hash.replace(/^#\/?/, '/').split('/')
  return {
    page: PAGES.includes(page) ? page : 'overview',
    machine: machine || null,
  }
}

function buildHash(page, machine) {
  return machine ? `#/${page}/${machine}` : `#/${page}`
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((page, machine) => {
    const next = buildHash(page, machine)
    if (window.location.hash === next) return
    window.location.hash = next
  }, [])

  return [route, navigate]
}

function Dashboard() {
  const [route, navigate] = useHashRoute()
  const { machines, loading } = useMachines()

  // Derived, not synced: the selection falls back to the first machine while
  // the fleet loads, and recovers on its own if the chosen one is removed.
  const selectedMachine =
    route.machine && machines.some(m => m.id === route.machine)
      ? route.machine
      : machines[0]?.id ?? null

  const openMachine = useCallback(id => navigate('diagnostics', id), [navigate])
  const selectMachine = useCallback(id => navigate('diagnostics', id), [navigate])
  const goTo = useCallback(page => {
    navigate(page, page === 'diagnostics' ? selectedMachine : null)
  }, [navigate, selectedMachine])

  // Put the resolved machine in the URL so a link to /diagnostics alone becomes
  // a link to the machine actually being shown.
  useEffect(() => {
    if (route.page !== 'diagnostics' || !selectedMachine) return
    if (route.machine === selectedMachine) return
    window.location.replace(buildHash('diagnostics', selectedMachine))
  }, [route.page, route.machine, selectedMachine])

  return (
    <div className="flex min-h-screen bg-bg-deep font-body">
      <Sidebar activePage={route.page} onNavigate={goTo} />
      <main className="flex-1 p-8 min-w-0">
        {route.page === 'overview' && (
          <OverviewPage machines={machines} loading={loading} onOpenMachine={openMachine} />
        )}
        {route.page === 'diagnostics' && (
          // Remounting on machine change resets every series and cursor, so
          // one machine's data can never bleed into another's charts.
          <DiagnosticsPage
            key={selectedMachine}
            machines={machines}
            machineId={selectedMachine}
            onSelectMachine={selectMachine}
          />
        )}
        {route.page === 'machines' && <MachinesPage />}
        {route.page === 'settings' && <SettingsPage />}
        {route.page === 'profile' && <ProfilePage />}
      </main>
    </div>
  )
}

// Sits inside SettingsProvider because the timeout length is a user preference.
function IdleGuard({ children }) {
  const { signOut, authConfigured: authOn } = useAuth()
  const { settings } = useSettings()
  const timeoutMs = idleTimeoutMs(settings.idleTimeoutId)

  const { msLeft, stayActive } = useIdleLogout({
    enabled: authOn,
    timeoutMs,
    onTimeout: signOut,
  })

  return (
    <>
      {children}
      {msLeft !== null && (
        <IdleWarning msLeft={msLeft} onStay={stayActive} onSignOut={signOut} />
      )}
    </>
  )
}

function Gate() {
  const { session, loading, authConfigured, recovering } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deep">
        <p className="text-slate-500 text-sm font-body">Checking session…</p>
      </div>
    )
  }

  if (authConfigured && !session) return <LoginPage />

  // Arriving from a reset email signs the user in immediately, so the password
  // form has to take priority over the dashboard until a new one is set.
  if (recovering) return <UpdatePasswordPage />

  return (
    <SettingsProvider>
      <IdleGuard>
        <MachinesProvider>
          <Dashboard />
        </MachinesProvider>
      </IdleGuard>
    </SettingsProvider>
  )
}

function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

export default App
