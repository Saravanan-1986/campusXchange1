import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, Badge, Spinner, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton, StarRating, Input } from '../components/ui/inputs.jsx';
import Timeline from '../components/resource/Timeline.jsx';
import ResourceGraph from '../components/resource/ResourceGraph.jsx';
import ReviewSection from '../components/resource/ReviewSection.jsx';
import ResourceCard from '../components/resource/ResourceCard.jsx';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'History Timeline' },
  { id: 'graph', label: 'Related Graph' },
  { id: 'reviews', label: 'Reviews' },
];

/** Resource detail — overview + temporal timeline + Neo4j graph + reviews. */
export default function ResourceDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState('overview');
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);

  const { data, isLoading, error } = useQuery({
    queryKey: ['resource', id],
    queryFn: async () => (await api.get(`/resources/${id}`)).data,
  });

  const { data: related } = useQuery({
    queryKey: ['related', id],
    queryFn: async () => (await api.get(`/graph/resources/${id}/related`)).data,
  });

  const resource = data?.resource;
  const isOwner = resource && user && String(resource.ownerId?._id || resource.ownerId) === user.id;

  const deal = useMutation({
    mutationFn: (dueDate) => api.post('/transactions', { resourceId: id, dueDate }),
    onSuccess: () => {
      pushToast({ title: 'Request sent ✉', message: 'Owner will accept or reject it.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['tx', 'mine'] });
    },
    onError: (err) => pushToast({ title: 'Request failed', message: errMsg(err), variant: 'danger' }),
  });

  const subscribe = useMutation({
    mutationFn: () => api.post('/requests', { resourceId: id, type: 'availability-alert' }),
    onSuccess: () => pushToast({
      title: 'Watching availability 👀',
      message: 'Active-DB rule will notify you the moment it becomes available.',
      variant: 'success', duration: 7000,
    }),
    onError: (err) => pushToast({ title: 'Subscribe failed', message: errMsg(err), variant: 'danger' }),
  });

  const report = useMutation({
    mutationFn: (reason) => api.post('/reports', { targetType: 'resource', targetId: id, reason }),
    onSuccess: () => pushToast({ title: 'Reported 🚩', message: 'Auto-flag ECA rule armed at 3 reports.', variant: 'warning' }),
  });

  if (isLoading) {
    return <div className="grid h-64 place-items-center"><Spinner className="h-8 w-8" /></div>;
  }
  if (error || !resource) {
    return <EmptyState icon="⚠" title="Resource unavailable" message={errMsg(error)} />;
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 text-xs text-ink-muted hover:text-ink">← back</button>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <HeroCard resource={resource} />
          <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl border border-white/8 bg-white/[0.03] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition ${
                  tab === t.id ? 'aurora-border text-ink shadow-glow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-5">
            {tab === 'overview' && <OverviewPanel resource={resource} related={related} />}
            {tab === 'timeline' && <Timeline resourceId={id} />}
            {tab === 'graph' && <ResourceGraph resourceId={id} />}
            {tab === 'reviews' && <ReviewSection targetType="resource" targetId={id} />}
          </div>
        </div>
        <div className="space-y-5">
          <DealPanel
            resource={resource} isOwner={isOwner}
            onDeal={(due) => deal.mutate(due)} busy={deal.isPending}
            onSubscribe={() => subscribe.mutate()}
            onReport={(r) => report.mutate(r)}
          />
          <OwnerCard owner={resource.ownerId} />
        </div>
      </div>
    </div>
  );
}

function HeroCard({ resource }) {
  return (
    <GlassCard hover={false} className="overflow-hidden">
      <div className="h-56 bg-gradient-to-br from-primary/25 via-accent/20 to-[#D946EF]/15">
        {resource.images?.[0] && (
          <img src={`/uploads/${resource.images[0]}`} alt={resource.title} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={resource.availability === 'available' ? 'success' : resource.availability === 'flagged' ? 'danger' : 'warning'}>
            {resource.availability}
          </Badge>
          <Badge tone="primary">{resource.category}</Badge>
          <Badge tone="muted">{resource.condition}</Badge>
          <Badge tone="accent">{resource.listingType}</Badge>
        </div>
        <h1 className="font-display text-2xl font-bold text-ink">{resource.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {resource.subject || resource.category} · {resource.department || 'General'} {resource.semester ? `· Sem ${resource.semester}` : ''}
          {resource.location?.label ? ` · ⌖ ${resource.location.label}` : ''}
        </p>
        {resource.description && <p className="mt-4 text-sm leading-relaxed text-ink-muted">{resource.description}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="font-display text-2xl font-bold aurora-text">
            {resource.listingType === 'sell' ? `₹${resource.price}` : resource.listingType === 'donate' ? 'Free' : resource.listingType === 'exchange' ? 'Exchange' : 'Lend'}
          </span>
          {resource.ratingCount > 0 && (
            <span className="flex items-center gap-1.5">
              <StarRating value={Math.round(resource.ratingAvg)} size={15} />
              <span className="text-xs text-ink-muted">{resource.ratingAvg} ({resource.ratingCount})</span>
            </span>
          )}
        </div>
        {resource.tags?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {resource.tags.map((t) => <Badge key={t} tone="muted">#{t}</Badge>)}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function OverviewPanel({ resource, related }) {
  if (!related?.data?.length) return null;
  return (
    <div>
      <h3 className="mb-3 font-display text-sm font-semibold text-ink">
        Related resources <span className="ml-2 text-[10px] font-normal text-ink-muted">({related.source})</span>
      </h3>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {related.data.slice(0, 6).map((r) => (
          <ResourceCard key={r.id} resource={{ _id: r.id, title: r.title, category: r.category }} />
        ))}
      </div>
    </div>
  );
}

function DealPanel({ resource, isOwner, onDeal, busy, onSubscribe, onReport }) {
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [showReport, setShowReport] = useState(false);
  return (
    <GlassCard hover={false} className="p-5">
      <h3 className="mb-3 font-display text-sm font-semibold text-ink">Take action</h3>
      {resource.availability === 'available' && !isOwner && (
        <div className="space-y-3">
          {resource.listingType === 'lend' && (
            <Input label="Return by" type="date" value={due} onChange={(e) => setDue(e.target.value)} hint="Overdue cron will remind both sides" />
          )}
          <GradientButton className="w-full" disabled={busy} onClick={() => onDeal(resource.listingType === 'lend' ? due : undefined)}>
            {busy ? 'Sending…' : resource.listingType === 'sell' ? 'Request to buy' : `Request to ${resource.listingType}`}
          </GradientButton>
        </div>
      )}
      {resource.availability !== 'available' && !isOwner && (
        <GradientButton variant="outline" className="w-full" onClick={onSubscribe}>
          👀 Alert me when available
        </GradientButton>
      )}
      {isOwner && <p className="text-xs text-ink-muted">Your listing — incoming requests appear on your Dashboard.</p>}
      <div className="mt-4 border-t border-white/8 pt-3">
        {showReport ? (
          <div className="flex gap-2">
            <select
              value={reason} onChange={(e) => setReason(e.target.value)}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-ink [&>option]:bg-space-800"
            >
              <option value="spam">Spam</option>
              <option value="wrong-info">Wrong info</option>
              <option value="offensive">Offensive</option>
              <option value="stolen">Not theirs</option>
              <option value="other">Other</option>
            </select>
            <GradientButton size="sm" variant="outline" onClick={() => { onReport(reason); setShowReport(false); }}>Send</GradientButton>
          </div>
        ) : (
          <button onClick={() => setShowReport(true)} className="text-[11px] text-danger/80 hover:text-danger">🚩 Report this listing</button>
        )}
      </div>
    </GlassCard>
  );
}

function OwnerCard({ owner }) {
  if (!owner) return null;
  return (
    <GlassCard hover={false} className="p-5">
      <h3 className="mb-3 font-display text-sm font-semibold text-ink">Listed by</h3>
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-aurora font-display text-base font-bold text-white shadow-glow-sm">
          {owner.name?.[0]?.toUpperCase()}
        </span>
        <div>
          <div className="text-sm font-semibold text-ink">{owner.name}</div>
          <div className="text-[11px] text-ink-muted">{owner.department || '—'} · Sem {owner.semester || '—'}</div>
        </div>
      </div>
    </GlassCard>
  );
}

