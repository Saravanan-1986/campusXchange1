import { useQuery } from '@tanstack/react-query';
import api from '../../api/axios.js';
import { GlassCard, Badge, Skeleton } from '../ui/primitives.jsx';

const FIELD_ICON = {
  price: '₹', condition: '✦', availability: '⇄', ownerId: '☺', title: '✎', location: '⌖',
};

function fmt(d) {
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * TEMPORAL PARADIGM visualization — vertical timeline of ResourceHistory
 * versions (validFrom/validTo snapshots). Owner names arrive pre-anonymized.
 */
export default function Timeline({ resourceId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['history', resourceId],
    queryFn: async () => (await api.get(`/resources/${resourceId}/history`)).data,
  });

  const { data: custodyData } = useQuery({
    queryKey: ['custody', resourceId],
    queryFn: async () => (await api.get(`/temporal/resources/${resourceId}/custody`)).data,
  });

  const custody = custodyData?.chain || [];

  if (isLoading) {
    return (
      <GlassCard hover={false} className="space-y-4 p-6">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </GlassCard>
    );
  }
  const history = data?.history || [];

  return (
    <div className="space-y-6">
      {/* PostgreSQL temporal custody chain */}
      <GlassCard hover={false} className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-ink">Custody chain</h3>
          <Badge tone="accent">PostgreSQL temporal (EXCLUDE GIST)</Badge>
        </div>
        {!custody.length ? (
          <p className="text-xs text-ink-muted">Single initial custodian on record.</p>
        ) : (
          <div className="space-y-3">
            {custody.map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] p-3 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/20 font-display text-xs font-bold text-accent-light">
                    #{c.hop_index || i + 1}
                  </span>
                  <div>
                    <div className="font-semibold text-ink">{c.owner_name}</div>
                    <div className="text-[10px] text-ink-muted">
                      {fmt(c.valid_from)} → {c.valid_to ? fmt(c.valid_to) : 'present'}
                      {c.days_held ? ` · held ${c.days_held} day${c.days_held > 1 ? 's' : ''}` : ''}
                    </div>
                  </div>
                </div>
                <div>
                  <Badge tone={c.is_current ? 'success' : 'muted'}>
                    {c.is_current ? 'current owner' : c.handover_kind || 'past custodian'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* MongoDB lifecycle history versions */}
      <GlassCard hover={false} className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-ink">Lifecycle timeline</h3>
          <Badge tone="success">MongoDB snapshots (validFrom / validTo)</Badge>
        </div>
        {!history.length && <p className="text-sm text-ink-muted">No history recorded yet.</p>}
        <div className="relative ml-3 border-l-2 border-accent/30 pl-6">
          {history.map((h) => (
            <div key={h._id} className="relative mb-6 last:mb-0">
              <span className="absolute -left-[31px] top-1 grid h-5 w-5 place-items-center rounded-full bg-space-800 text-[10px] text-accent-light shadow-glow-sm ring-1 ring-accent/40">
                {FIELD_ICON[h.change?.fields?.[0]] || '•'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-semibold text-ink">v{h.version} · {h.change?.summary}</span>
                {h.source === 'automation' && <Badge tone="warning">automation</Badge>}
                {h.validTo == null && <Badge tone="success">current state</Badge>}
              </div>
              <div className="mt-1 text-[11px] text-ink-muted">
                valid from {fmt(h.validFrom)}{h.validTo ? ` → ${fmt(h.validTo)}` : ''} · recorded {fmt(h.recordedAt)}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {h.snapshot?.price > 0 && <Badge tone="muted">₹{h.snapshot.price}</Badge>}
                {h.snapshot?.condition && <Badge tone="muted">{h.snapshot.condition}</Badge>}
                {h.snapshot?.availability && <Badge tone="muted">{h.snapshot.availability}</Badge>}
                {h.snapshot?.ownerName && <Badge tone="muted">owner: {h.snapshot.ownerName}</Badge>}
                <Badge tone="muted">by {h.actorLabel}</Badge>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
