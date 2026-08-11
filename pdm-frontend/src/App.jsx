import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import OverviewPage from './pages/OverviewPage'
import DiagnosticsPage from './pages/DiagnosticsPage'
import './index.css'

function App() {
  const [activePage, setActivePage] = useState('overview')
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    const fetchLatest = () => {
      fetch('/api/machines/motor01/latest')
        .then(res => res.json())
        .then(setLatest)
        .catch(err => console.error('Latest fetch failed:', err))
    }
    fetchLatest()
    const id = setInterval(fetchLatest, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex min-h-screen bg-bg-deep font-body">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="flex-1 p-8">
        {activePage === 'overview' && <OverviewPage latest={latest} />}
        {activePage === 'diagnostics' && <DiagnosticsPage />}
      </main>
    </div>
  )
}

export default App