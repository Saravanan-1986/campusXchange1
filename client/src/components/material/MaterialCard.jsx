import { Link } from 'react-router-dom';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { StarRating } from '../ui/inputs.jsx';

const TYPE_META = {
  notes: { icon: '✍', label: 'Notes', tone: 'primary' },
  'question-paper': { icon: '❓', label: 'Question Paper', tone: 'accent' },
  'lab-manual': { icon: '🧪', label: 'Lab Manual', tone: 'success' },
  'project-reference': { icon: '🚀', label: 'Project Ref', tone: 'warning' },
  other: { icon: '❖', label: 'Other', tone: 'muted' },
};

export default function MaterialCard({ material }) {
  const t = TYPE_META[material.type] || TYPE_META.other;
  return (
    <Link to={`/materials/${material._id}`}>
      <GlassCard className="group h-full p-4">
        <div className="flex items-start justify-between">
          <div className={`grid h-10 w-10 place-items-center rounded-xl text-lg ${t.tone === 'primary' ? 'bg-primary/15' : t.tone === 'accent' ? 'bg-accent/15' : t.tone === 'success' ? 'bg-success/15' : 'bg-warning/15'}`}>
            {t.icon}
          </div>
          <Badge tone={t.tone}>{t.label}</Badge>
        </div>
        <h3 className="mt-3 truncate font-display text-sm font-semibold text-ink group-hover:text-primary-light">{material.title}</h3>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {material.department || 'General'} · Sem {material.semester ?? '—'} · {material.subject || '—'}
        </p>
        {material.description && <p className="mt-2 line-clamp-2 text-xs text-ink-muted/80">{material.description}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            {material.ratingCount > 0 && (
              <>
                <StarRating value={Math.round(material.ratingAvg)} size={13} />
                <span className="text-[10px] text-ink-muted">{material.ratingAvg}</span>
              </>
            )}
          </span>
          <span className="text-[10px] text-ink-muted">⬇ {material.downloads}</span>
        </div>
      </GlassCard>
    </Link>
  );
}
