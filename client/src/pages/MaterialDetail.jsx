import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, Badge, Spinner, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import ReviewSection from '../components/resource/ReviewSection.jsx';

/** Material detail — inline PDF preview (iframe), download counter, reviews. */
export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['material', id],
    queryFn: async () => (await api.get(`/materials/${id}`)).data,
  });

  if (isLoading) return <div className="grid h-64 place-items-center"><Spinner className="h-8 w-8" /></div>;
  if (error || !data?.material) return <EmptyState icon="⚠" title="Material unavailable" message={errMsg(error)} />;
  const m = data.material;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 text-xs text-ink-muted hover:text-ink">← back</button>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <GlassCard hover={false} className="overflow-hidden">
            <iframe
              title={m.title}
              src={`/uploads/${m.file.filename}`}
              className="h-[520px] w-full bg-white/5"
            />
          </GlassCard>
          <ReviewSection targetType="material" targetId={id} />
        </div>

        <div className="space-y-5">
          <GlassCard hover={false} className="p-6">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge tone="primary">{m.type}</Badge>
              <Badge tone="muted">{m.department || 'General'}</Badge>
              <Badge tone="muted">Sem {m.semester ?? '—'}</Badge>
            </div>
            <h1 className="font-display text-xl font-bold text-ink">{m.title}</h1>
            {m.description && <p className="mt-3 text-sm text-ink-muted">{m.description}</p>}
            <div className="mt-4 space-y-1.5 text-xs text-ink-muted">
              <div>Subject: {m.subject || '—'}</div>
              <div>Uploaded by: {m.uploadedBy?.name}</div>
              <div>⬇ {m.downloads} downloads · {(m.file.size / 1024).toFixed(0)} KB</div>
            </div>
            <GradientButton className="mt-5 w-full" onClick={() => window.open(`/uploads/${m.file.filename}`, '_blank')}>
              ⬇ Open / download
            </GradientButton>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
