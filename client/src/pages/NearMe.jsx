import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import ResourceCard from '../components/resource/ResourceCard.jsx';
import { GlassCard, SectionTitle, Badge, EmptyState, Spinner } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useUI } from '../store/ui.js';

/**
 * NEAR ME — Postgres spatial list view (no map).
 * Center = your current location. Radius search runs in
 * Postgres (PostGIS / earthdistance / haversine) over geo_resource, then items
 * are listed as cards with distance badges. Every listing gets its coordinates
 * at creation time, so this list just works.
 */
export default function NearMe() {
  const [center, setCenter] = useState(null); // [lat, lon]
  const [label, setLabel] = useState('');
  const [radius, setRadius] = useState(5);
  const [centerError, setCenterError] = useState('');
  const pushToast = useUI((s) => s.pushToast);

  useEffect(() => {
    locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['spatial-near', center, radius],
    enabled: !!center,
    queryFn: async () => (await api.get('/spatial/resources/near', {
      params: { at: `${center[1]},${center[0]}`, radius, availability: 'available' },
    })).data,
  });

  function locate(silent = false) {
    if (!navigator.geolocation) {
      const message = 'Geolocation is unavailable in this browser — enable location access to see nearby items.';
      setCenterError(message);
      if (!silent) pushToast({ title: 'Location unavailable', message, variant: 'warning' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter([pos.coords.latitude, pos.coords.longitude]);
        setLabel('Your location');
        setCenterError('');
        if (!silent) pushToast({ title: 'Centered on you ⌖', message: 'Postgres radius query executed over geo_resource.', variant: 'success' });
      },
      () => {
        const message = 'Location permission denied — allow location access to load items near you.';
        setCenterError(message);
        if (!silent) pushToast({ title: 'Location needed', message, variant: 'warning' });
      },
      { timeout: 8000 }
    );
  }

  const distOf = (r) => {
    const sql = data?.sqlRows?.find?.((s) => String(s.resource_id) === String(r._id));
    if (sql?.distance_m != null) return (Number(sql.distance_m) / 1000).toFixed(2);
    if (r.distanceKm != null) return Number(r.distanceKm).toFixed(2);
    return null;
  };

  return (
    <div>
      <SectionTitle
        title="Nearby items"
        subtitle="Listings closest to you — straight from Postgres spatial queries. No map, just distances."
        right={<DbTechBadge paradigm="spatial" tag />}
      />

      <GlassCard hover={false} className="violet-panel mb-5 flex flex-wrap items-center gap-4 p-4">
        <GradientButton size="sm" onClick={() => locate()}>⌖ Use my location</GradientButton>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Radius
          <input type="range" min="1" max="25" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-32 accent-[#A855F7]" />
          <Badge tone="primary">{radius} km</Badge>
        </label>
        {center && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
            <Badge tone="success">⌖ {label || 'center'} · {center[1].toFixed(4)}, {center[0].toFixed(4)}</Badge>
            {data?.provider && <Badge tone="muted">pg · {data.provider}</Badge>}
          </span>
        )}
      </GlassCard>

      {isLoading && <div className="grid h-60 place-items-center"><Spinner className="h-8 w-8" /></div>}
      {error && <EmptyState icon="⚠" title="Spatial query failed" message={errMsg(error)} />}

      {!center && !isLoading && !error && (
        <EmptyState
          icon="⌖"
          title="Location needed"
          message={centerError || 'Allow location access to load items near you.'}
        />
      )}
      {center && !isLoading && !error && !(data?.resources?.length) && (
        <EmptyState
          icon="⌖"
          title="Nothing nearby yet"
          message={`No available listings within ${radius} km. List one with a location pin and it will show up here instantly.`}
        />
      )}

      {(data?.resources?.length > 0) && (
        <>
          <p className="mb-3 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{data.resources.length}</span> item(s) within{' '}
            <span className="font-semibold text-ink">{data.radiusKm ?? radius} km</span>
            {' '}— sorted nearest-first · <Link to="/resources" className="text-primary-light hover:underline">browse all</Link>
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {data.resources.map((r) => <ResourceCard key={r._id} resource={r} distanceKm={distOf(r)} />)}
          </div>
          <div className="mt-4 text-center">
            <GradientButton size="sm" variant="outline" onClick={() => refetch()}>↻ Refresh nearby</GradientButton>
          </div>
        </>
      )}
    </div>
  );
}

