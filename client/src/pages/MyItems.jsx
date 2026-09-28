import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, Spinner, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import { useUI } from '../store/ui.js';

export function MyItemsContent() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [filter, setFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['resources', 'mine'],
    queryFn: async () => (await api.get('/resources/mine')).data,
  });

  const unlist = useMutation({
    mutationFn: (id) => api.post(`/resources/${id}/unlist`),
    onSuccess: () => {
      pushToast({ title: 'Item unlisted', message: 'Hidden from feed.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (err) => pushToast({ title: 'Failed', message: errMsg(err), variant: 'danger' }),
  });

  const relist = useMutation({
    mutationFn: ({ id, listingType, price }) => api.post(`/resources/${id}/relist`, { listingType, price }),
    onSuccess: () => {
      pushToast({ title: 'Item re-listed 🚀', message: 'Visible on feed again.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (err) => pushToast({ title: 'Failed', message: errMsg(err), variant: 'danger' }),
  });

  const items = data?.resources || [];
  const filtered = items.filter((it) => {
    if (filter === 'listed') return it.isListed !== false;
    if (filter === 'unlisted') return it.isListed === false;
    return true;
  });

  return { filter, setFilter, items, filtered, isLoading, unlist, relist };
}

export default function MyItems() {
  const { filter, setFilter, items, filtered, isLoading, unlist, relist } = MyItemsContent();

  return (
    <div>
      <SectionTitle
        title="My items"
        subtitle="Manage your listings, pause items, or relist items."
        right={
          <div className="flex items-center gap-2">
            <Link to="/items-received">
              <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-ink hover:border-accent/40">
                📥 Items received
              </button>
            </Link>
            <Link to="/resources/new">
              <GradientButton size="sm">＋ List a resource</GradientButton>
            </Link>
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['all', 'listed', 'unlisted'].map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
              filter === k ? 'aurora-border text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {k} ({k === 'all' ? items.length : items.filter((i) => (k === 'listed' ? i.isListed !== false : i.isListed === false)).length})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid h-48 place-items-center"><Spinner className="h-8 w-8" /></div>
      ) : !filtered.length ? (
        <EmptyState
          icon="📦"
          title="No items found"
          message={filter === 'unlisted' ? 'No unlisted items.' : 'You have not listed any resources yet.'}
          action={<Link to="/resources/new"><GradientButton size="sm">List your first resource</GradientButton></Link>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((it) => {
            const isListed = it.isListed !== false;
            return (
              <GlassCard key={it._id} hover={false} className="flex flex-col justify-between p-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge tone={isListed ? 'success' : 'muted'}>{isListed ? '● Listed' : '○ Hidden'}</Badge>
                    <Badge tone="primary">{it.category}</Badge>
                  </div>
                  <Link to={`/resources/${it._id}`} className="block">
                    <h3 className="truncate font-display text-base font-semibold text-ink hover:text-primary-light">{it.title}</h3>
                  </Link>
                  <p className="mt-1 text-xs text-ink-muted">{it.subject || it.category} · {it.department || 'General'}</p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="font-display text-lg font-bold text-ink">
                      {it.listingType === 'sell' ? `₹${it.price}` : it.listingType === 'donate' ? 'Free' : it.listingType}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-ink-muted">{it.condition}</span>
                    {it.transferCount > 0 && (
                      <span className="ml-auto text-[11px] text-accent-light">{it.transferCount} transfer{it.transferCount > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3">
                  <Link to={`/resources/${it._id}`} className="text-xs text-ink-muted hover:text-ink">View details</Link>
                  {isListed ? (
                    <button
                      onClick={() => unlist.mutate(it._id)}
                      disabled={unlist.isPending}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-ink-muted hover:border-warning/50 hover:text-warning disabled:opacity-50"
                    >
                      Hide from marketplace
                    </button>
                  ) : (
                    <button
                      onClick={() => relist.mutate({ id: it._id, listingType: it.listingType, price: it.price })}
                      disabled={relist.isPending}
                      className="rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary-light hover:bg-primary/25 disabled:opacity-50"
                    >
                      Re-list now
                    </button>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

