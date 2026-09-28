import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, Spinner, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton, Input } from '../components/ui/inputs.jsx';
import { useUI } from '../store/ui.js';

function RelistModal({ item, onClose, onRelist, isPending }) {
  const [listingType, setListingType] = useState('donate');
  const [price, setPrice] = useState('0');

  const submit = (e) => {
    e.preventDefault();
    onRelist({
      id: item._id,
      listingType,
      price: listingType === 'sell' ? Number(price) : 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-space-950/80 p-4 backdrop-blur-sm">
      <GlassCard hover={false} className="w-full max-w-md p-6">
        <h3 className="font-display text-lg font-bold text-ink">Re-list “{item.title}”</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Pass it forward — offer it free or sell it to the next student.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setListingType('donate')}
              className={`flex-1 rounded-xl p-2.5 text-xs font-semibold transition ${
                listingType === 'donate' ? 'aurora-border text-ink' : 'border border-white/10 bg-white/5 text-ink-muted'
              }`}
            >
              🎁 Donate (free)
            </button>
            <button
              type="button"
              onClick={() => setListingType('sell')}
              className={`flex-1 rounded-xl p-2.5 text-xs font-semibold transition ${
                listingType === 'sell' ? 'aurora-border text-ink' : 'border border-white/10 bg-white/5 text-ink-muted'
              }`}
            >
              🏷 Sell
            </button>
          </div>
          {listingType === 'sell' && (
            <Input
              label="Price (₹)"
              type="number"
              min="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 250"
            />
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <GradientButton type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Re-listing…' : 'Publish to marketplace'}
            </GradientButton>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

export default function ItemsReceived() {
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [relistTarget, setRelistTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['resources', 'received'],
    queryFn: async () => (await api.get('/resources/received')).data,
  });

  const relist = useMutation({
    mutationFn: ({ id, listingType, price }) => api.post(`/resources/${id}/relist`, { listingType, price }),
    onSuccess: () => {
      pushToast({ title: 'Item re-listed 🚀', message: 'It is now active on the marketplace.', variant: 'success' });
      setRelistTarget(null);
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (err) => pushToast({ title: 'Re-list failed', message: errMsg(err), variant: 'danger' }),
  });

  const items = data?.resources || [];

  return (
    <div>
      <SectionTitle
        title="Items received"
        subtitle="Things handed over to you by other students. Re-list them anytime to keep the campus cycle going."
        right={
          <Link to="/my-items">
            <button className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-ink hover:border-accent/40">
              ← Back to My items
            </button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="grid h-48 place-items-center"><Spinner className="h-8 w-8" /></div>
      ) : !items.length ? (
        <EmptyState
          icon="📥"
          title="No received items yet"
          message="When another student donates or sells an item to you via chat, it lands here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const isListed = it.isListed !== false;
            return (
              <GlassCard key={it._id} hover={false} className="flex flex-col justify-between p-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge tone={isListed ? 'success' : 'muted'}>
                      {isListed ? '● On marketplace' : '○ In your custody'}
                    </Badge>
                    <Badge tone="accent">
                      via {it.receivedVia || 'handover'}
                    </Badge>
                  </div>
                  <Link to={`/resources/${it._id}`} className="block">
                    <h3 className="truncate font-display text-base font-semibold text-ink hover:text-primary-light">
                      {it.title}
                    </h3>
                  </Link>
                  <p className="mt-1 text-xs text-ink-muted">
                    From {it.receivedFrom?.name || 'former owner'} · {it.receivedAt ? new Date(it.receivedAt).toLocaleDateString() : 'recent'}
                  </p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="font-display text-lg font-bold text-ink">
                      {it.listingType === 'sell' ? `₹${it.price}` : it.listingType === 'donate' ? 'Free' : it.listingType}
                    </span>
                    <span className="ml-auto text-[11px] text-accent-light">
                      {it.transferCount || 1} handover{(it.transferCount || 1) > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3">
                  <Link to={`/resources/${it._id}`} className="text-xs text-ink-muted hover:text-ink">
                    View history
                  </Link>
                  {isListed ? (
                    <span className="text-xs text-success">Active listing ✓</span>
                  ) : (
                    <GradientButton size="sm" onClick={() => setRelistTarget(it)}>
                      Re-list for others →
                    </GradientButton>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {relistTarget && (
        <RelistModal
          item={relistTarget}
          onClose={() => setRelistTarget(null)}
          onRelist={(payload) => relist.mutate(payload)}
          isPending={relist.isPending}
        />
      )}
    </div>
  );
}

