import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, SectionTitle, Badge, EmptyState, Spinner } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useUI } from '../store/ui.js';
import { Link } from 'react-router-dom';

/** SPATIAL PARADIGM — Leaflet map over $geoWithin / $near results. */
export default function NearMe() {
  const [center, setCenter] = useState(null);
  const [radius, setRadius] = useState(5);
  const pushToast = useUI((s) => s.pushToast);

  const { data, isLoading, error } = useQuery({
    queryKey: ['spatial', center, radius],
    enabled: !!center,
    queryFn: async () => (await api.get('/spatial/resources/near', { params: { at: center.join(','), radius, availability: 'available' } })).data,
  });

  const locate = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter([pos.coords.latitude, pos.coords.longitude]);
        pushToast({ title: 'Centered on you ⌖', message: 'MongoDB $geoWithin query executed.', variant: 'success' });
      },
      () => pushToast({
        title: 'Using demo campus location',
        message: 'Permission denied — showing the seeded campus center.',
        variant: 'warning',
      })
    );
  };

  // Demo fallback center (matches seeder: 77.5946, 12.9716)
  const useDemo = () => setCenter([12.9716, 77.5946]);

  const view = center || [12.9716, 77.5946];

  return (
    <div>
      <SectionTitle
        title="Near Me"
        subtitle="Resources available around you — powered by geospatial queries."
        right={<DbTechBadge paradigm="spatial" tag />}
      />
      <GlassCard hover={false} className="mb-5 flex flex-wrap items-center gap-4 p-4">
        <GradientButton size="sm" onClick={locate}>⌖ Use my location</GradientButton>
        <GradientButton size="sm" variant="outline" onClick={useDemo}>Demo campus center</GradientButton>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Radius
          <input type="range" min="1" max="25" value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-32 accent-[#8B5CF6]" />
          <Badge tone="primary">{radius} km</Badge>
        </label>
        {center && <Badge tone="success">querying [ {center[1].toFixed(4)}, {center[0].toFixed(4)} ]</Badge>}
      </GlassCard>

      {isLoading && <div className="grid h-80 place-items-center"><Spinner className="h-8 w-8" /></div>}
      {error && <EmptyState icon="⚠" title="Spatial query failed" message={errMsg(error)} />}

      <GlassCard hover={false} className="overflow-hidden">
        <MapContainer center={view} zoom={15} className="h-[480px] w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {center && <Circle center={center} radius={radius * 1000} pathOptions={{ color: '#8B5CF6', fillColor: '#3B82F6', fillOpacity: 0.08, weight: 1 }} />}
          {(data?.resources || []).map((r) => {
            const [lng, lat] = r.location?.coordinates || [];
            if (!Number.isFinite(lat)) return null;
            return (
              <Marker key={r._id} position={[lat, lng]} icon={glassIcon()}>
                <Popup>
                  <div className="min-w-[180px]">
                    <div className="font-semibold text-sm" style={{ fontFamily: '"Space Grotesk", sans-serif' }}>{r.title}</div>
                    <div className="text-[11px] opacity-75 mt-0.5">
                      {r.listingType === 'sell' ? `₹${r.price}` : r.listingType} · {r.condition} · {r.availability}
                    </div>
                    <a href={`/resources/${r._id}`} className="text-[12px] underline" style={{ color: '#60A5FA' }}>open listing →</a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </GlassCard>

      {data?.resources?.length > 0 && (
        <p className="mt-3 text-center text-xs text-ink-muted">
          {data.resources.length} resource(s) found within {data.radiusKm} km
          {' — '}<Link to="/resources" className="text-primary-light hover:underline">browse list view</Link>
        </p>
      )}
    </div>
  );
}

// Custom glass divIcon (avoids default-marker asset path issues)
function glassIcon() {
  return L.divIcon({ className: '', html: '<div class="cx-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
}
