function Sidebar({ activePage, onNavigate }) {
  const items = [
    { id: 'overview', label: 'Overview' },
    { id: 'diagnostics', label: 'Diagnostics' },
  ]

  return (
    <nav className="w-48 shrink-0 bg-bg-panel border-r border-border-glow min-h-screen p-4 flex flex-col gap-1">
      <div className="font-display text-slate-200 text-lg mb-6 px-2">Motor 01</div>
      {items.map(item => (
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
    </nav>
  )
}

export default Sidebar