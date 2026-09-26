import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios.js';
import { useAuth } from '../../store/auth.js';
import { useUI } from '../../store/ui.js';
import DbTechBadge from '../common/DbTechBadge.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '◈' },
  { to: '/resources', label: 'Marketplace', icon: '⇄' },
  { to: '/materials', label: 'Knowledge Hub', icon: '❖' },
  { to: '/near-me', label: 'Nearby items', icon: '⌖' },
  { to: '/chat', label: 'Chat', icon: '💬' },
  { to: '/notifications', label: 'Notifications', icon: '◔' },
  { to: '/profile', label: 'Profile', icon: '☺' },
];

export default function Sidebar() {
  const { user, logout, token } = useAuth();
  const { sidebarOpen, toggleSidebar, chatUnread, setChatUnread } = useUI();

  // CHAT badge baseline — refreshed every 20s; live deltas arrive via socket.
  useQuery({
    queryKey: ['conversations', 'badge'],
    queryFn: async () => {
      const data = (await api.get('/messages/conversations')).data;
      setChatUnread(data.unreadTotal || 0);
      return data;
    },
    enabled: !!token,
    refetchInterval: 20000,
  });

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/8 glass transition-all duration-300 ${sidebarOpen ? 'w-60' : 'w-[68px]'}`}
    >
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-aurora aurora-anim font-display text-lg font-bold text-white shadow-glow">
          C
        </div>
        {sidebarOpen && (
          <div>
            <div className="font-display text-base font-bold tracking-tight text-ink">Campus<span className="aurora-text">Xchange</span></div>
            <div className="text-[10px] uppercase tracking-widest text-ink-muted">5-DB showcase</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2.5 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                isActive
                  ? 'aurora-border font-semibold text-ink shadow-glow-sm'
                  : 'text-ink-muted hover:bg-white/5 hover:text-ink'
              }`
            }
          >
            <span className="w-5 text-center text-base">{item.icon}</span>
            {sidebarOpen && <span className="truncate">{item.label}</span>}
            {item.to === '/chat' && chatUnread > 0 && (
              <span
                className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-glow ${
                  sidebarOpen ? 'ml-auto' : 'absolute right-1.5 top-1'
                }`}
              >
                {chatUnread > 9 ? '9+' : chatUnread}
              </span>
            )}
          </NavLink>
        ))}
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            title="Admin"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                isActive ? 'aurora-border font-semibold text-ink' : 'text-warning/90 hover:bg-white/5 hover:text-warning'
              }`
            }
          >
            <span className="w-5 text-center text-base">⬢</span>
            {sidebarOpen && <span>Admin Panel</span>}
          </NavLink>
        )}
      </nav>

      <div className="border-t border-white/8 p-3">
        {sidebarOpen && user && (
          <div className="mb-2 rounded-xl bg-white/5 px-3 py-2.5">
            <div className="truncate text-sm font-semibold text-ink">{user.name}</div>
            <div className="truncate text-[11px] text-ink-muted">
              {user.department || '—'} · Sem {user.semester} · {user.role}
            </div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="mb-1 w-full rounded-xl px-3 py-2 text-left text-xs text-ink-muted hover:bg-white/5 hover:text-ink"
        >
          <span className="w-5 inline-block text-center">⇤</span>
          {sidebarOpen && 'Collapse'}
        </button>
        <button
          onClick={logout}
          className="w-full rounded-xl px-3 py-2 text-left text-xs text-danger/90 hover:bg-danger/10"
        >
          <span className="w-5 inline-block text-center">⏻</span>
          {sidebarOpen && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
