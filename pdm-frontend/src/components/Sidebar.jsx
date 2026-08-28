import { useAuth } from '../contexts/authStore'

const ITEMS = [
  { id: 'profile', label: 'Profile' },
  { id: 'overview', label: 'Overview' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'machines', label: 'Machines' },
  { id: 'settings', label: 'Settings' },
]

function Sidebar({ activePage, onNavigate }) {
  const { user, authConfigured, signOut } = useAuth()

  return (
    // Sticky with its own viewport height: the Diagnostics page is far taller
    // than the screen, and without this the nav stretches with it and the sign
    // out control ends up far below the fold.
    <nav className="w-48 shrink-0 bg-bg-panel border-r border-border-glow
                    sticky top-0 h-screen p-4 flex flex-col gap-1">
      <div className="font-display text-slate-200 text-base mb-6 px-2 leading-tight">
        Predictive<br />Maintenance
      </div>

      {ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`text-left px-3 py-2 rounded-lg font-body text-sm tracking-wide transition-colors ${
            activePage === item.id
              ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          {item.label}
        </button>
      ))}

      {authConfigured && user && (
        <div className="mt-auto pt-4 border-t border-border-glow">
          <p className="px-3 text-[11px] text-slate-500 truncate" title={user.email}>
            {user.email}
          </p>
          <button
            onClick={signOut}
            className="mt-1 w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}

export default Sidebar
