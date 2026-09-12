import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, Skeleton, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useAuth } from '../store/auth.js';

function fmt(d) { return new Date(d).toLocaleDateString(); }

/** Bento-grid dashboard — personal stats, deal tracker, DB-paradigm status strip. */
export default function Dashboard() {
  const { user } = useAuth();

  const { data: status } = useQuery({ queryKey: ['sys'], queryFn: async () => (await api.get('/system/status')).data, refetchInterval: 20000 });
  const { data: txData } = useQuery({ queryKey: ['tx', 'mine'], queryFn: async () => (await api.get('/transactions/mine')).data });
  const { data: mine } = useQuery({ queryKey: ['resources', 'mine'], queryFn: async () => (await api.get('/resources/mine')).data });

  const deals = [...(txData?.incoming || []), ...(txData?.outgoing || [])].slice(0, 6);
  const stats = [
    { label: 'My listings', value: mine?.resources?.length ?? '—', icon: '⇄', to: '/resources' },
    { label: 'Open deals', value: deals.filter((d) => d.status === 'pending' || d.status === 'accepted').length || '—', icon: '✉', to: '/dashboard' },
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

      {/* 5-paradigm status strip */}
      <GlassCard hover={false} className="mb-6 flex flex-wrap items-center gap-4 p-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">DB Monitor</span>
        <StatusPill label="MongoDB" value={status?.status?.mongodb} />
        <StatusPill label="Neo4j" value={status?.status?.graph} />
        <StatusPill label="Change Streams" value={status?.status?.activeChangeStreams} />
        <Link to="/how-it-works" className="ml-auto text-[11px] text-primary-light hover:underline">what powers this →</Link>
      </GlassCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <GlassCard className="p-5">
              <div className="text-xl opacity-70">{s.icon}</div>
              <div className="mt-2 font-display text-2xl font-bold text-ink">{s.value}</div>
              <div className="text-xs text-ink-muted">{s.label}</div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
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
          <h3 className="mb-4 font-display text-sm font-semibold text-ink">What runs under the hood</h3>
          <div className="space-y-3 text-xs text-ink-muted">
            {[
              ['mongodb', 'Every page you see reads/writes MongoDB documents.'],
              ['graph', 'Related resources are Neo4j traversals — try the Graph tab on any listing.'],
              ['temporal', 'Every price/owner/availability change writes a versioned snapshot.'],
              ['active', 'Change Streams + cron fire ECA rules → live notifications.'],
              ['spatial', 'Near Me runs $geoWithin on a 2dsphere index.'],
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
  const ok = value === 'connected';
  return (
    <span className="flex items-center gap-2 text-xs text-ink-muted">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-success shadow-glow' : 'bg-warning'}`} />
      {label}: <span className="font-medium text-ink">{value || '…'}</span>
    </span>
  );
}
