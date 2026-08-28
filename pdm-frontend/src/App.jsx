import { useCallback, useState } from 'react'
import Sidebar from './components/Sidebar'
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
import { useMachines } from './contexts/machinesStore'
import './index.css'

function Dashboard() {
  const [activePage, setActivePage] = useState('overview')
  const [requestedMachine, setRequestedMachine] = useState(null)
  const { machines, loading } = useMachines()

  // Derived, not synced: the selection falls back to the first machine while
  // the fleet loads, and recovers on its own if the chosen one is removed.
  const selectedMachine =
    requestedMachine && machines.some(m => m.id === requestedMachine)
      ? requestedMachine
      : machines[0]?.id ?? null

  const openMachine = useCallback(id => {
    setRequestedMachine(id)
    setActivePage('diagnostics')
  }, [])

  return (
    <div className="flex min-h-screen bg-bg-deep font-body">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="flex-1 p-8 min-w-0">
        {activePage === 'overview' && (
          <OverviewPage machines={machines} loading={loading} onOpenMachine={openMachine} />
        )}
        {activePage === 'diagnostics' && (
          // Remounting on machine change resets every series and cursor, so
          // one machine's data can never bleed into another's charts.
          <DiagnosticsPage
            key={selectedMachine}
            machines={machines}
            machineId={selectedMachine}
            onSelectMachine={setRequestedMachine}
          />
        )}
        {activePage === 'machines' && <MachinesPage />}
        {activePage === 'settings' && <SettingsPage />}
        {activePage === 'profile' && <ProfilePage />}
      </main>
    </div>
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
      <MachinesProvider>
        <Dashboard />
      </MachinesProvider>
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
