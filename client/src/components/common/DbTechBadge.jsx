import { PARADIGM_META } from '../../theme/theme.js';

/** Small colored badge naming one of the five DB paradigms (feature → tech map). */
export default function DbTechBadge({ paradigm, tag = false, className = '' }) {
  const meta = PARADIGM_META[paradigm];
  if (!meta) return null;
  const colorMap = {
    mongodb: 'border-primary/40 text-primary-light',
    graph: 'border-accent/40 text-accent-light',
    temporal: 'border-success/40 text-success',
    active: 'border-warning/40 text-warning',
    spatial: 'border-[#D946EF]/50 text-[#E879F9]',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colorMap[paradigm]} ${className}`}
      title={`${meta.label} — ${meta.tag}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
      {meta.label}
      {tag && <span className="font-normal normal-case opacity-70">· {meta.tag}</span>}
    </span>
  );
}
