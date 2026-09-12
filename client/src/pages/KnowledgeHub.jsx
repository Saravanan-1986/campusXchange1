import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.js';
import MaterialCard from '../components/material/MaterialCard.jsx';
import MaterialUpload from '../components/material/MaterialUpload.jsx';
import { GlassCard, SectionTitle, EmptyState, CardSkeletonGrid, Badge } from '../components/ui/primitives.jsx';
import { Select, Input, GradientButton } from '../components/ui/inputs.jsx';
import { useUI } from '../store/ui.js';

const TYPES = ['notes', 'question-paper', 'lab-manual', 'project-reference', 'other'];

/** Knowledge Hub — department → semester → subject → type browse tree. */
export default function KnowledgeHub() {
  const [filters, setFilters] = useState({});
  const [showUpload, setShowUpload] = useState(false);
  const pushToast = useUI((s) => s.pushToast);

  const { data, isLoading } = useQuery({
    queryKey: ['materials', filters],
    queryFn: async () => (await api.get('/materials', { params: filters })).data,
  });

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v || undefined }));

  return (
    <div>
      <SectionTitle
        title="Knowledge Hub"
        subtitle="Notes, question papers, lab manuals & project references — organized by your syllabus tree."
        right={
          <GradientButton size="sm" onClick={() => setShowUpload((s) => !s)}>
            {showUpload ? 'Close' : '＋ Upload material'}
          </GradientButton>
        }
      />
      {showUpload && (
        <div className="mb-6">
          <MaterialUpload onDone={() => setShowUpload(false)} />
        </div>
      )}

      <GlassCard hover={false} className="mb-6 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Input placeholder="Search…" value={filters.q || ''} onChange={(e) => setF('q', e.target.value)} />
          <Select value={filters.department || ''} onChange={(e) => setF('department', e.target.value)}>
            <option value="">Department</option>
            {(data?.facets || []).map((f) => (
              <option key={f._id} value={f._id}>{f._id || 'General'} ({f.count})</option>
            ))}
          </Select>
          <Select value={filters.semester || ''} onChange={(e) => setF('semester', e.target.value)}>
            <option value="">Semester</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Sem {s}</option>)}
          </Select>
          <Select value={filters.subject || ''} onChange={(e) => setF('subject', e.target.value)}>
            <option value="">Subject</option>
            {[...new Set((data?.facets || []).flatMap((f) => f.subjects).filter(Boolean))].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={filters.type || ''} onChange={(e) => setF('type', e.target.value)}>
            <option value="">Type</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
      </GlassCard>

      {isLoading ? (
        <CardSkeletonGrid count={6} />
      ) : !data?.materials?.length ? (
        <EmptyState icon="❖" title="No materials here yet" message="Be the first to upload notes or papers for this branch." />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
            <Badge tone="muted">{data.materials.length} result(s)</Badge>
            <span className="text-[10px]">browse hierarchy: dept → sem → subject → type</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.materials.map((m) => <MaterialCard key={m._id} material={m} />)}
          </div>
        </>
      )}
    </div>
  );
}
