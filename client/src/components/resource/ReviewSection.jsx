import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../../api/axios.js';
import { GlassCard, Badge, EmptyState } from '../ui/primitives.jsx';
import { StarRating, GradientButton, Textarea } from '../ui/inputs.jsx';
import { useAuth } from '../../store/auth.js';
import { useUI } from '../../store/ui.js';

/** Reviews & ratings — stars + comments, synced to Mongo aggregates & Neo4j edges. */
export default function ReviewSection({ targetType, targetId }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const { data } = useQuery({
    queryKey: ['reviews', targetType, targetId],
    queryFn: async () => (await api.get(`/reviews/${targetType}/${targetId}`)).data,
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/reviews', { targetType, targetId, rating, comment }),
    onSuccess: () => {
      pushToast({ title: 'Review saved ⭐', message: 'Aggregates + graph edges updated.', variant: 'success' });
      setComment('');
      qc.invalidateQueries({ queryKey: ['reviews', targetType, targetId] });
      qc.invalidateQueries({ queryKey: ['resource', targetId] });
    },
    onError: (err) => pushToast({ title: 'Review failed', message: errMsg(err), variant: 'danger' }),
  });

  const mine = (data?.reviews || []).find((r) => r.user?._id === user?.id);

  return (
    <GlassCard hover={false} className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-ink">Reviews & ratings</h3>
        {data?.reviews?.length > 0 && (
          <span className="text-xs text-ink-muted">{data.reviews.length} review(s)</span>
        )}
      </div>

      {user && (
        <div className="mb-5 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-xs uppercase tracking-wider text-ink-muted">
              {mine ? 'Update your review' : 'Rate this'}
            </span>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <Textarea
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="How was the condition/quality? (optional)"
            className="min-h-[70px]"
          />
          <div className="mt-2 flex justify-end">
            <GradientButton size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mine ? 'Update review' : 'Submit review'}
            </GradientButton>
          </div>
        </div>
      )}

      {!data?.reviews?.length ? (
        <EmptyState icon="☆" title="No reviews yet" message="Be the first to rate this on campus." />
      ) : (
        <div className="space-y-3">
          {data.reviews.map((r) => (
            <div key={r._id} className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-aurora text-[11px] font-bold text-white">
                    {r.user?.name?.[0]?.toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-ink">{r.user?.name}</span>
                  {r.user?.department && <Badge tone="muted">{r.user.department}</Badge>}
                </div>
                <StarRating value={r.rating} size={14} />
              </div>
              {r.comment && <p className="mt-2 text-sm text-ink-muted">{r.comment}</p>}
              <p className="mt-1.5 text-[10px] text-ink-muted/70">{new Date(r.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
