import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios.js';
import { useUI } from '../../store/ui.js';
import { useAuth } from '../../store/auth.js';
import { GradientButton } from '../ui/inputs.jsx';

/** Topbar — global search + live notification bell (Active DB badge). */
export default function Topbar() {
  const [q, setQ] = useState('');
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);
  const navigate = useNavigate();
  const { unread, setUnread } = useUI();
  const { user, token } = useAuth();

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'top'],
    queryFn: async () => (await api.get('/notifications?limit=8')).data,
    enabled: !!token,
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (notifData) setUnread(notifData.unreadCount || 0);
  }, [notifData, setUnread]);

  useEffect(() => {
    const close = (e) => bellRef.current && !bellRef.current.contains(e.target) && setBellOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    navigate(`/resources?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 glass px-4 py-3 sm:px-8" style={{ backdropFilter: 'blur(20px)' }}>
      <div className="flex items-center gap-4">
        <form onSubmit={submit} className="relative flex-1 max-w-xl">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search resources, subjects, tags…"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm text-ink placeholder:text-ink-muted/60 outline-none focus:border-primary/60 focus:shadow-glow-sm"
          />
          <span className="absolute left-3.5 top-2.5 text-ink-muted">⌕</span>
        </form>

        <div className="ml-auto flex items-center gap-3">
          <Link to="/resources/new">
            <GradientButton size="sm" className="hidden sm:inline-flex">＋ List a resource</GradientButton>
          </Link>
          <div ref={bellRef} className="relative">
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-ink transition hover:border-accent/50"
              aria-label="Notifications"
            >
              ◔
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4.5 min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-glow">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="glass-strong absolute right-0 top-11 w-80 rounded-2xl p-2">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Live notifications</span>
                  <Link to="/notifications" className="text-[11px] text-primary-light hover:underline" onClick={() => setBellOpen(false)}>
                    view all
                  </Link>
                </div>
                <div className="max-h-80 overflow-auto">
                  {(notifData?.notifications || []).map((n) => (
                    <button
                      key={n._id}
                      onClick={() => { setBellOpen(false); if (n.link) navigate(n.link); }}
                      className="w-full rounded-xl px-3 py-2 text-left hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2 text-sm text-ink">
                        {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-light" />}
                        <span className="truncate font-medium">{n.title}</span>
                      </div>
                      <div className="ml-3.5 truncate text-[11px] text-ink-muted">{n.message}</div>
                    </button>
                  ))}
                  {!notifData?.notifications?.length && (
                    <div className="px-3 py-6 text-center text-xs text-ink-muted">Nothing yet — ECA rules are quiet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <Link to="/profile" className="grid h-9 w-9 place-items-center rounded-xl bg-aurora font-display text-sm font-bold text-white shadow-glow-sm">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </Link>
        </div>
      </div>
    </header>
  );
}
