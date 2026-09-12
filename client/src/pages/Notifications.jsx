import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, EmptyState, CardSkeletonGrid } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';

const PARADIGM_OF = {
  active: 'active', availability: 'active', transaction: 'active', overdue: 'active', report: 'active',
};

/** Notification center — inbox of Active-DB automation + user activity. */
export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications?limit=50')).data,
    refetchInterval: 20000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div>
      <SectionTitle
        title="Notification Center"
        subtitle="ECA rule outputs, cron reminders and deal activity land here."
        right={
          <div className="flex items-center gap-3">
            <DbTechBadge paradigm="active" tag />
            <GradientButton size="sm" variant="outline" disabled={!data?.unreadCount} onClick={() => markAll.mutate()}>
              Mark all read {data?.unreadCount ? `(${data.unreadCount})` : ''}
            </GradientButton>
          </div>
        }
      />
      {isLoading ? (
        <CardSkeletonGrid count={4} />
      ) : !data?.notifications?.length ? (
        <EmptyState icon="◔" title="All quiet" message="When rules fire — e.g. a watched resource becomes available — you'll see it here instantly." />
      ) : (
        <div className="space-y-3">
          {data.notifications.map((n) => (
            <GlassCard
              key={n._id}
              className={`p-4 cursor-pointer ${!n.read ? 'border-primary/30' : ''}`}
              onClick={() => n.link && navigate(n.link)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary-light shadow-glow" />}
                    <span className="text-sm font-semibold text-ink">{n.title}</span>
                  </div>
                  {n.message && <p className="mt-1 text-xs text-ink-muted">{n.message}</p>}
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-muted/70">
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                    {n.meta?.paradigm && <DbTechBadge paradigm={n.meta.paradigm} />}
                    {n.meta?.extra?.rule && <Badge tone="muted">rule: {n.meta.extra.rule}</Badge>}
                    {n.meta?.extra?.cron && <Badge tone="warning">cron: {n.meta.extra.cron}</Badge>}
                  </div>
                </div>
                {PARADIGM_OF[n.type] && <Badge tone="warning">auto</Badge>}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
