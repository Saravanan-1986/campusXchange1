import { Link } from 'react-router-dom';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { StarRating } from '../ui/inputs.jsx';

const AVAILABILITY_TONE = {
  available: 'success', unavailable: 'muted', lent: 'warning', reserved: 'warning', flagged: 'danger',
};

const CATEGORY_ICON = {
  textbook: '📘', calculator: '🧮', 'lab-kit': '🧪', tool: '🛠',
  'electronic-component': '⚡', 'project-resource': '🚀', other: '📦',
};

/** Marketplace card — image, price/deal type, condition, availability, rating. */
export default function ResourceCard({ resource, distanceKm = null }) {
  const cover = resource.images?.[0];
  return (
    <Link to={`/resources/${resource._id}`}>
      <GlassCard className="group h-full overflow-hidden">
        <div className="relative h-36 overflow-hidden rounded-t-2xl bg-gradient-to-br from-primary/20 to-accent/20">
          {cover ? (
            <img src={`/uploads/${cover}`} alt={resource.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
          ) : (
            <div className="grid h-full place-items-center text-4xl opacity-60 transition group-hover:scale-110">
              {CATEGORY_ICON[resource.category] || '📦'}
            </div>
          )}
          <div className="absolute left-2.5 top-2.5 flex gap-1.5">
            <Badge tone={AVAILABILITY_TONE[resource.availability] || 'muted'}>{resource.availability}</Badge>
          </div>
          {distanceKm != null && (
            <div className="absolute right-2.5 top-2.5">
              <Badge tone="primary" className="bg-space-800/80">⌖ {distanceKm} km</Badge>
            </div>
          )}
        </div>
        <div className="p-4">
          <h3 className="truncate font-display text-sm font-semibold text-ink group-hover:text-primary-light">{resource.title}</h3>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {resource.subject || resource.category} · {resource.department || 'General'} {resource.semester ? `· Sem ${resource.semester}` : ''}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-lg font-bold text-ink">
                {resource.listingType === 'sell' ? `₹${resource.price}` : resource.listingType === 'donate' ? 'Free' : resource.listingType === 'exchange' ? 'Exchange' : 'Lend'}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-ink-muted">{resource.condition}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {resource.ratingCount > 0 && (
                <>
                  <StarRating value={Math.round(resource.ratingAvg)} size={13} />
                  <span className="text-[10px] text-ink-muted">({resource.ratingCount})</span>
                </>
              )}
            </div>
          </div>
          <div className="mt-2 truncate text-[11px] text-ink-muted">
            by {resource.ownerId?.name || 'student'}
            {resource.location?.label ? ` · ⌖ ${resource.location.label}` : ''}
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}
