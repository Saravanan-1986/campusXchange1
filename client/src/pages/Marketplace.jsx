import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.js';
import ResourceCard from '../components/resource/ResourceCard.jsx';
import { GlassCard, EmptyState, CardSkeletonGrid, SectionTitle, Badge } from '../components/ui/primitives.jsx';
import { Select, Input, GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';

const CATEGORIES = ['textbook', 'calculator', 'lab-kit', 'tool', 'electronic-component', 'project-resource', 'other'];
const CONDITIONS = ['new', 'like-new', 'good', 'fair'];
const LISTING_TYPES = ['sell', 'donate', 'exchange', 'lend'];
const AVAILABILITY = ['available', 'unavailable', 'lent', 'reserved', 'flagged'];

/** Marketplace — browse + filter. SPATIAL: distance filter via browser geolocation. */
export default function Marketplace() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(params.entries());
  const [nearMe, setNearMe] = useState(false);
  const [userCoords, setUserCoords] = useState(null);

  const query = useMemo(() => {
    const q = { ...filters };
    if (nearMe && userCoords) {
      q.near = `${userCoords[0]},${userCoords[1]}`;
      q.radius = filters.radius || '5';
    } else {
      delete q.near; delete q.radius;
    }
    return q;
  }, [filters, nearMe, userCoords]);

  const { data, isLoading } = useQuery({
    queryKey: ['resources', query],
    queryFn: async () => (await api.get('/resources', { params: query })).data,
  });

  const setF = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const toggleNearMe = () => {
    if (nearMe) { setNearMe(false); setF('near', null); return; }
    if (!navigator.geolocation) return alert('Geolocation unavailable in this browser');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserCoords([pos.coords.longitude, pos.coords.latitude]); setNearMe(true); },
      () => alert('Could not get your location — grant permission or try again.')
    );
  };

  return (
    <div>
      <SectionTitle
        title="Resource Marketplace"
        subtitle="Textbooks, calculators, lab kits, tools & components — from your campus only."
        right={<div className="flex gap-2"><DbTechBadge paradigm="mongodb" tag /></div>}
      />

      <GlassCard hover={false} className="mb-6 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Input placeholder="Search…" value={filters.q || ''} onChange={(e) => setF('q', e.target.value)} className="col-span-2" />
          <Select value={filters.category || ''} onChange={(e) => setF('category', e.target.value)}>
            <option value="">Category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.condition || ''} onChange={(e) => setF('condition', e.target.value)}>
            <option value="">Condition</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.listingType || ''} onChange={(e) => setF('listingType', e.target.value)}>
            <option value="">Deal type</option>
            {LISTING_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.availability || ''} onChange={(e) => setF('availability', e.target.value)}>
            <option value="">Availability</option>
            {AVAILABILITY.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.sort || ''} onChange={(e) => setF('sort', e.target.value)}>
            <option value="">Sort</option>
            <option value="newest">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
            <option value="rating">Top rated</option>
          </Select>
          <div className="flex items-center gap-2">
            <GradientButton
              variant={nearMe ? 'aurora' : 'outline'} size="sm" className="w-full"
              onClick={toggleNearMe}
            >
              ⌖ Near me
            </GradientButton>
          </div>
        </div>
        {(filters.minPrice || filters.maxPrice || nearMe) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/8 pt-3 text-xs text-ink-muted">
            {nearMe && (
              <>
                <span>Radius</span>
                <input type="range" min="1" max="25" value={filters.radius || '5'} onChange={(e) => setF('radius', e.target.value)} className="w-32 accent-[#8B5CF6]" />
                <Badge tone="primary">{filters.radius || 5} km</Badge>
              </>
            )}
            <span className="ml-auto">Price range:</span>
            <input className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1" placeholder="min ₹" value={filters.minPrice || ''} onChange={(e) => setF('minPrice', e.target.value)} />
            <input className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1" placeholder="max ₹" value={filters.maxPrice || ''} onChange={(e) => setF('maxPrice', e.target.value)} />
          </div>
        )}
      </GlassCard>

      {isLoading ? (
        <CardSkeletonGrid count={6} />
      ) : !data?.resources?.length ? (
        <EmptyState icon="⇄" title="No resources match" message="Try clearing filters — or be the first to list something on campus." />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.resources.map((r) => <ResourceCard key={r._id} resource={r} />)}
        </div>
      )}
    </div>
  );
}
