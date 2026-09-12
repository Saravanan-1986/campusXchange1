import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import api from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, Spinner } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useUI } from '../store/ui.js';
import { PARADIGM_META } from '../theme/theme.js';

const TABS = ['DB Monitor', 'Reports', 'Users'];

/** Admin — DB Technology Monitor (live 5-paradigm feed), reports queue, users. */
export default function Admin() {
  const [tab, setTab] = useState('DB Monitor');
  return (
    <div>
      <SectionTitle
        title="Admin Control"
        subtitle="Reports queue, user management and the live five-database monitor."
      />
      <div className="mb-5 flex gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${
              tab === t ? 'aurora-border text-ink shadow-glow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'DB Monitor' && <MonitorPanel />}
      {tab === 'Reports' && <ReportsPanel />}
      {tab === 'Users' && <UsersPanel />}
    </div>
  );
}

function MonitorPanel() {
  const { dbEvents } = useUI();
  const { data, isLoading } = useQuery({
    queryKey: ['monitor'],
    queryFn: async () => (await api.get('/admin/monitor')).data,
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="grid h-64 place-items-center"><Spinner className="h-8 w-8" /></div>;
  const counts = data?.counts || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Object.entries(PARADIGM_META).map(([p, meta]) => (
          <GlassCard key={p} className="p-4">
            <DbTechBadge paradigm={p} />
            <div className="mt-2 font-display text-2xl font-bold text-ink">{counts[p] ?? 0}</div>
            <div className="text-[11px] text-ink-muted">{meta.tag}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard hover={false} className="p-5">
        <h3 className="mb-3 font-display text-sm font-semibold text-ink">Engine status</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(data?.status || {}).filter(([k]) => k !== 'activeRules').map(([k, v]) => (
            <Badge key={k} tone={String(v).includes('connected') ? 'success' : 'warning'}>
              {k}: {String(v)}
            </Badge>
          ))}
          <Badge tone="muted">{data?.status?.activeRules?.length || 0} ECA rules armed</Badge>
        </div>
      </GlassCard>

      <GlassCard hover={false} className="p-5">
        <h3 className="mb-3 font-display text-sm font-semibold text-ink">
          Live event feed <span className="ml-2 text-[10px] font-normal text-ink-muted">(Socket.io: db:event · REST refresh 15s)</span>
        </h3>
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {dbEvents.length > 0 && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-2 text-[11px] text-success">
              ⚡ {dbEvents.length} event(s) streamed live this session
            </div>
          )}
          {(data?.events || []).map((ev, i) => (
            <motion.div
              key={ev._id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i < 8 ? i * 0.04 : 0 }}
              className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3"
            >
              <DbTechBadge paradigm={ev.paradigm} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{ev.message}</div>
                <div className="text-[10px] text-ink-muted/70">{ev.type} · {new Date(ev.createdAt).toLocaleTimeString()}</div>
              </div>
            </motion.div>
          ))}
          {!data?.events?.length && <p className="py-6 text-center text-xs text-ink-muted">No events yet — trigger a rule to see it live.</p>}
        </div>
      </GlassCard>
    </div>
  );
}


function ReportsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: async () => (await api.get('/admin/reports')).data,
  });
  const act = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/admin/reports/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reports'] }),
  });
  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  if (!data?.reports?.length) {
    return <GlassCard hover={false} className="p-10 text-center text-sm text-ink-muted">Queue empty — nothing reported. 🎉</GlassCard>;
  }
  return (
    <div className="space-y-3">
      {data.reports.map((r) => (
        <GlassCard key={r._id} hover={false} className="flex flex-wrap items-center gap-3 p-4">
          <Badge tone={r.status === 'open' ? 'danger' : 'muted'}>{r.status}</Badge>
          <span className="text-sm text-ink">{r.targetType} <span className="text-ink-muted">· {r.reason}</span></span>
          <span className="ml-auto flex gap-2">
            <GradientButton size="sm" variant="outline" onClick={() => act.mutate({ id: r._id, status: 'dismissed' })}>Dismiss</GradientButton>
            <GradientButton size="sm" onClick={() => act.mutate({ id: r._id, status: 'resolved' })}>Resolve</GradientButton>
          </span>
          <div className="w-full text-[11px] text-ink-muted">
            by {r.reporter?.name} · {new Date(r.createdAt).toLocaleString()} {r.details ? `· "${r.details}"` : ''}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get('/admin/users')).data,
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/admin/users/${id}/role`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  if (isLoading) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  return (
    <GlassCard hover={false} className="overflow-x-auto p-2">
      <table className="w-full text-left text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-ink-muted">
          <tr>
            {['User', 'Email', 'Dept / Sem', 'Verified', 'Role', ''].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {(data?.users || []).map((u) => (
            <tr key={u._id} className="border-t border-white/6 text-sm">
              <td className="px-3 py-2.5 font-medium text-ink">{u.name}</td>
              <td className="px-3 py-2.5 text-ink-muted">{u.collegeEmail}</td>
              <td className="px-3 py-2.5 text-ink-muted">{u.department} · {u.semester}</td>
              <td className="px-3 py-2.5"><Badge tone={u.verified ? 'success' : 'danger'}>{u.verified ? '✓' : '✗'}</Badge></td>
              <td className="px-3 py-2.5"><Badge tone={u.role === 'admin' ? 'warning' : 'primary'}>{u.role}</Badge></td>
              <td className="px-3 py-2.5">
                <button
                  onClick={() => setRole.mutate({ id: u._id, role: u.role === 'admin' ? 'student' : 'admin' })}
                  className="text-[11px] text-primary-light hover:underline"
                >
                  {u.role === 'admin' ? 'demote' : 'promote'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );
}
