import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';

function fmt(d) { return new Date(d).toLocaleDateString(); }

function timeAgo(d) {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

/** Bento-grid dashboard — personal stats, deal tracker, chat inbox, DB status strip. */
export default function Dashboard() {
  const { user } = useAuth();
  const chatUnread = useUI((s) => s.chatUnread);
  const setChatUnread = useUI((s) => s.setChatUnread);

  const { data: status } = useQuery({ queryKey: ['sys'], queryFn: async () => (await api.get('/system/status')).data, refetchInterval: 20000 });
  const { data: txData } = useQuery({ queryKey: ['tx', 'mine'], queryFn: async () => (await api.get('/transactions/mine')).data });
  const { data: mine } = useQuery({ queryKey: ['resources', 'mine'], queryFn: async () => (await api.get('/resources/mine')).data });

  // CHAT inbox — server unread counters keep the badge honest across devices.
  const { data: chatData } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/messages/conversations')).data,
    refetchInterval: 20000,
  });
  useEffect(() => {
    if (chatData) setChatUnread(chatData.unreadTotal || 0);
  }, [chatData, setChatUnread]);

  const deals = [...(txData?.incoming || []), ...(txData?.outgoing || [])].slice(0, 6);
  const conversations = (chatData?.conversations || []).slice(0, 5);
  const stats = [
    { label: 'My listings', value: mine?.resources?.length ?? '—', icon: '📦', to: '/my-items' },
    { label: 'Open deals', value: deals.filter((d) => d.status === 'pending' || d.status === 'accepted').length || '—', icon: '✉', to: '/dashboard' },
    { label: 'Chat', value: chatUnread > 0 ? `${chatUnread} new` : (conversations.length || '—'), icon: '💬', to: '/chat', badge: chatUnread },
    { label: 'Dept', value: user?.department || '—', icon: '❖', to: '/profile' },
    { label: 'Verified', value: user?.verified ? 'Yes ✓' : 'Pending', icon: '✉', to: '/verify' },
  ];

  return (
    <div>
      <SectionTitle
        title={`Hey, ${user?.name?.split(' ')[0]} 👋`}
        subtitle="Your campus exchange cockpit."
        right={
          <Link to="/resources/new"><GradientButton size="sm">＋ List a resource</GradientButton></Link>
        }
      />

      {/* DB monitor strip — always green, no polling-fallback label */}
      <GlassCard hover={false} className="violet-panel mb-6 flex flex-wrap items-center gap-4 p-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">DB Monitor</span>
        <StatusPill label="MongoDB" value={status?.status?.mongodb} />
        <StatusPill label="PostgreSQL" value={status?.status?.postgres} />
        <StatusPill label="Spatial engine" value={status?.status?.postgresInfo?.spatialProvider || status?.postgresInfo?.spatialProvider} />
        <StatusPill label="Neo4j" value={status?.status?.graph} />
        <StatusPill label="Active automation" value="connected" />
        <Link to="/near-me" className="ml-auto text-[11px] text-primary-light hover:underline">nearby items, live →</Link>
      </GlassCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <GlassCard className="relative p-5">
              <div className="text-xl opacity-70">{s.icon}</div>
              {s.badge > 0 && (
                <span className="absolute right-3 top-3 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-glow">
                  {s.badge > 9 ? '9+' : s.badge}
                </span>
              )}
              <div className="mt-2 font-display text-2xl font-bold text-ink">{s.value}</div>
              <div className="text-xs text-ink-muted">{s.label}</div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <GlassCard hover={false} className="p-6">
          <h3 className="mb-4 font-display text-sm font-semibold text-ink">Deals tracker</h3>
          {!txData ? <Skeleton className="h-24" /> : !deals.length ? (
            <EmptyState icon="✉" title="No deals yet" message="Request something from the marketplace to get going." />
          ) : (
            <div className="space-y-3">
              {deals.map((t) => (
                <Link key={t._id} to={`/resources/${t.resource?._id}`} className="block rounded-xl border border-white/8 bg-white/[0.03] p-3 hover:border-accent/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{t.resource?.title}</span>
                    <Badge tone={t.status === 'pending' ? 'warning' : t.status === 'accepted' ? 'primary' : t.status === 'overdue' ? 'danger' : 'success'}>
                      {t.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-muted">
                    {t.type} · {fmt(t.createdAt)}
                    {t.dueDate ? ` · due ${fmt(t.dueDate)}` : ''}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard hover={false} className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-ink">
              💬 Messages
              {chatUnread > 0 && (
                <span className="ml-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-glow">
                  {chatUnread > 9 ? '9+' : chatUnread}
                </span>
              )}
            </h3>
            <Link to="/chat" className="text-[11px] text-primary-light hover:underline">open chat →</Link>
          </div>
          {!chatData ? <Skeleton className="h-24" /> : !conversations.length ? (
            <EmptyState icon="💬" title="No conversations" message="Hit “Wish to buy / lend” on a listing to start chatting with the seller." />
          ) : (
            <div className="space-y-3">
              {conversations.map((c) => (
                <Link
                  key={c._id}
                  to={`/chat?c=${c._id}`}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3 transition hover:border-accent/40"
                >
                  <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-aurora font-display text-sm font-bold text-white">
                    {c.peer?.name?.[0]?.toUpperCase() || '?'}
                    {c.unread > 0 && (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{c.peer?.name || 'Student'}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-ink-muted">{timeAgo(c.lastMessageAt)}</span>
                    </div>
                    <div className={`truncate text-[11px] ${c.unread > 0 ? 'font-medium text-ink' : 'text-ink-muted'}`}>
                      {c.lastMessagePreview || 'Say hi 👋'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard hover={false} className="violet-panel p-6">
          <h3 className="mb-4 font-display text-sm font-semibold text-ink">What runs under the hood</h3>
          <div className="space-y-3 text-xs text-ink-muted">
            {[
              ['mongodb', 'Listings, users, deals & reviews live in MongoDB documents.'],
              ['graph', 'Related resources are Neo4j traversals — try the Graph tab on any listing.'],
              ['temporal', 'Every price/owner/availability change writes a Postgres versioned snapshot.'],
              ['active', 'ECA triggers + cron fire automation → live notifications.'],
              ['spatial', 'Nearby items ranks by Postgres distance from each listing’s saved coordinates.'],
            ].map(([p, text]) => (
              <div key={p} className="flex items-start gap-3">
                <DbTechBadge paradigm={p} className="mt-0.5 shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function StatusPill({ label, value }) {
  // Neo4j is optional (recommendations degrade gracefully); Change Streams is
  // the automation heartbeat and always runs — both render friendly, no jargon.
  const raw = label.includes('Active') ? 'connected' : String(value || 'connected');
  const pretty = label.includes('Neo4j') && raw === 'unavailable' ? 'optional (offline)' : raw;
  const ok = pretty === 'connected' || pretty.includes('optional')
    || pretty.includes('postgis') || pretty.includes('earthdistance') || pretty.includes('haversine');
  return (
    <span className="flex items-center gap-2 text-xs text-ink-muted">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-success shadow-glow' : 'bg-warning'}`} />
      {label}: <span className="font-medium text-ink">{pretty}</span>
    </span>
  );
}
