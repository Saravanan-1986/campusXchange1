import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, SectionTitle, Badge } from '../components/ui/primitives.jsx';
import { Input, Select, Textarea, GradientButton } from '../components/ui/inputs.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useUI } from '../store/ui.js';

const CATEGORIES = ['textbook', 'calculator', 'lab-kit', 'tool', 'electronic-component', 'project-resource', 'other'];
const CONDITIONS = ['new', 'like-new', 'good', 'fair'];
const LISTING_TYPES = ['sell', 'donate', 'exchange', 'lend'];

/** List a resource — images via Multer, optional geotag (spatial), history auto-recorded (temporal). */
export default function CreateResource() {
  const [form, setForm] = useState({
    title: '', description: '', category: 'textbook', subject: '', department: 'Computer Science',
    semester: 5, condition: 'good', listingType: 'sell', price: 0, tags: '',
  });
  const [files, setFiles] = useState([]);
  const [geotag, setGeotag] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const captureLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeotag({ coordinates: [pos.coords.longitude, pos.coords.latitude], label: 'My current spot' });
        pushToast({ title: 'Location pinned ⌖', message: 'Findable via Near Me (2dsphere query).', variant: 'success' });
      },
      () => pushToast({ title: 'Location denied', message: 'Listing saved without geotag.', variant: 'warning' })
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (geotag) fd.append('location', JSON.stringify(geotag));
      files.forEach((f) => fd.append('images', f));
      const { data } = await api.post('/resources', fd);
      pushToast({ title: 'Listing live 🎉', message: 'A temporal version + Neo4j node were written on save.', variant: 'success', duration: 7000 });
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
              options={['Computer Science', 'Electronics', 'Mechanical', 'Applied Sciences'].map((d) => ({ value: d, label: d }))} />
            <Input label="Semester" type="number" min="1" max="10" value={form.semester} onChange={set('semester')} />
          </div>
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
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">Geotag (Near Me)</span>
              <div className="flex items-center gap-2">
                <GradientButton type="button" variant="outline" size="sm" onClick={captureLocation}>
                  {geotag ? '⌖ Re-pin location' : '⌖ Pin my location'}
                </GradientButton>
                {geotag && (
                  <Badge tone="success">
                    {geotag.coordinates[0].toFixed(4)}, {geotag.coordinates[1].toFixed(4)}
                  </Badge>
                )}
              </div>
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
