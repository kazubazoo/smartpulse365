import { useAuth } from '../contexts/authStore'

// Profile is only shown when there is an account to show — without Supabase
// there is no login, so the page would be a column of dashes and a sign-out
// button that does nothing.
const ITEMS = [
  { id: 'profile', label: 'Profile', needsAuth: true },
  { id: 'overview', label: 'Overview' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'machines', label: 'Machines' },
  { id: 'settings', label: 'Settings' },
]

function Sidebar({ activePage, onNavigate }) {
  const { user, authConfigured, signOut } = useAuth()
  const items = ITEMS.filter(item => !item.needsAuth || authConfigured)

  return (
    // md and up: a sticky column with its own viewport height, so the sign-out
    // control stays in reach on a Diagnostics page far taller than the screen.
    // Below md: a bar across the top that scrolls sideways if it has to, so the
    // charts get the full width of a tablet or phone. `min-w-0` is what lets it
    // scroll: without it, a flex item will not shrink below the combined width
    // of its buttons, and the nav pushes the whole page wider than the screen.
    <nav className="shrink-0 min-w-0 bg-bg-panel border-b md:border-b-0 md:border-r border-border-glow
                    flex md:flex-col items-center md:items-stretch gap-1
                    px-3 py-2 md:p-4 overflow-x-auto
                    md:w-48 md:sticky md:top-0 md:h-screen">
      <div className="font-display text-slate-200 text-sm md:text-base md:mb-6 px-2 leading-tight shrink-0 mr-2 md:mr-0">
        Predictive<br className="hidden md:inline" /> Maintenance
      </div>

      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          aria-current={activePage === item.id ? 'page' : undefined}
          className={`shrink-0 text-left px-3 py-2 rounded-lg font-body text-sm tracking-wide transition-colors border ${
            activePage === item.id
              ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30'
              : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          {item.label}
        </button>
      ))}

      {authConfigured && user && (
        <div className="ml-auto md:ml-0 md:mt-auto md:pt-4 md:border-t border-border-glow shrink-0 flex md:block items-center gap-2">
          <p className="hidden md:block px-3 text-[11px] text-slate-500 truncate" title={user.email}>
            {user.email}
          </p>
          <button
            onClick={signOut}
            className="md:mt-1 md:w-full text-left px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  )
}

export default Sidebar
