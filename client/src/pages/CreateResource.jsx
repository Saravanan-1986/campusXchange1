import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, SectionTitle, Badge } from '../components/ui/primitives.jsx';
import { Input, Select, Textarea, GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useUI } from '../store/ui.js';
import { DEPARTMENTS, isOtherDepartment, resolveDepartment } from '../lib/departments.js';

const CATEGORIES = ['textbook', 'calculator', 'lab-kit', 'tool', 'electronic-component', 'project-resource', 'other'];
const CONDITIONS = ['new', 'like-new', 'good', 'fair'];
const LISTING_TYPES = ['sell', 'donate', 'exchange', 'lend'];

// Campus pickup: no hardcoded spots. Sellers pin their real location at
// listing time (GPS + custom label); the server geo-tags it in Postgres
// and snaps it to the nearest campus zone via a spatial trigger.

/** List a resource — location is captured at listing time (Postgres geo_resource), history + graph written on save. */
export default function CreateResource() {
  const [form, setForm] = useState({
    title: '', description: '', category: 'textbook', subject: '', department: 'Computer Science',
    customDepartment: '', semester: 5, condition: 'good', listingType: 'sell', price: 0, tags: '',
  });
  const [files, setFiles] = useState([]);
  // Pickup spot: the seller pins their real location at listing time. The
  // server snaps it to the nearest campus zone (Postgres spatial trigger),
  // so Nearby items ranks it by true distance with zero hardcoded places.
  const [spot, setSpot] = useState('__gps');
  const [customLabel, setCustomLabel] = useState('');
  const [pin, setPin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const pickSpot = (name) => {
    setSpot(name);
    if (name !== '__gps' && pin) setPin({ ...pin, label: customLabel || pin.label });
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      pushToast({ title: 'Geolocation unavailable', message: 'Enable location access to pin your pickup spot.', variant: 'warning' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ coordinates: [pos.coords.longitude, pos.coords.latitude], label: customLabel || 'My current spot' });
        setSpot('__gps');
        pushToast({ title: 'Location pinned ⌖', message: 'Coordinates captured — Near Me will rank this by Postgres distance.', variant: 'success' });
      },
      () => pushToast({ title: 'Location needed', message: 'Could not capture your spot — allow location access and try again.', variant: 'warning' }),
      { timeout: 8000 }
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!pin || !Array.isArray(pin.coordinates)) {
      setError('Pin your pickup location first — tap “⌖ Pin my exact spot” so Nearby items can rank this listing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries({
        ...form,
        department: resolveDepartment(form.department, form.customDepartment),
      }).forEach(([k, v]) => { if (k !== 'customDepartment') fd.append(k, v); });
      // Coordinates captured at listing time → stored in PG geo_resource via sync service.
      fd.append('location', JSON.stringify({ ...pin, label: customLabel || pin.label }));
      files.forEach((f) => fd.append('images', f));
      const { data } = await api.post('/resources', fd);
      pushToast({ title: 'Listing live 🎉', message: 'Geo-tagged in Postgres — visible in Nearby items instantly.', variant: 'success', duration: 7000 });
      navigate(`/resources/${data.resource._id}`);
    } catch (err) {
      setError(errMsg(err, 'Could not create listing'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <SectionTitle
        title="List a resource"
        subtitle="Goes live instantly — history snapshot + graph node written on save."
        right={<DbTechBadge paradigm="temporal" tag />}
      />
      <GlassCard hover={false} className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Input label="Title" required value={form.title} onChange={set('title')} placeholder="Operating Systems — Galvin (9th Ed)" />
          <Textarea label="Description" value={form.description} onChange={set('description')} placeholder="Condition details, edition, what's included…" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Select label="Category" value={form.category} onChange={set('category')} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Input label="Subject" value={form.subject} onChange={set('subject')} placeholder="Database Systems" />
            <Select label="Department" value={form.department} onChange={set('department')}
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} />
            <Input label="Semester" type="number" min="1" max="10" value={form.semester} onChange={set('semester')} />
          </div>
          {isOtherDepartment(form.department) && (
            <Input label="Your department" required value={form.customDepartment} onChange={set('customDepartment')} placeholder="e.g. Food Technology" />
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Select label="Condition" value={form.condition} onChange={set('condition')} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
            <Select label="Deal type" value={form.listingType} onChange={set('listingType')} options={LISTING_TYPES.map((c) => ({ value: c, label: c }))} />
            <Input label="Price (₹)" type="number" min="0" value={form.price} onChange={set('price')} disabled={form.listingType !== 'sell'} />
            <Input label="Tags" value={form.tags} onChange={set('tags')} placeholder="os, book, cse" />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">Images (up to 4)</span>
              <input
                type="file" accept="image/*" multiple
                onChange={(e) => setFiles([...e.target.files].slice(0, 4))}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent/20 file:px-3 file:py-1 file:text-xs file:text-accent-light"
              />
            </div>
            <div className="violet-panel rounded-xl p-3">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">Pickup location (saved with listing) *</span>
              <Input placeholder="Label e.g. Library entrance / Hostel B Room 214" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <GradientButton type="button" variant="outline" size="sm" onClick={captureLocation}>
                  ⌖ Pin my exact spot
                </GradientButton>
                {pin ? (
                  <Badge tone="success">⌖ {Number(pin.coordinates[0]).toFixed(4)}, {Number(pin.coordinates[1]).toFixed(4)}</Badge>
                ) : (
                  <Badge tone="warning">No pin yet — tap “Pin my exact spot”</Badge>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-ink-muted">Your real GPS point is stored in Postgres <code>geo_resource</code> — Nearby items ranks by distance from this point.</p>
            </div>
          </div>
          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <GradientButton type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</GradientButton>
            <GradientButton type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish listing'}</GradientButton>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
