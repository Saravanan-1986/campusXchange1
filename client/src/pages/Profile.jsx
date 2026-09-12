import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { useAuth } from '../store/auth.js';
import { GlassCard, SectionTitle, Badge } from '../components/ui/primitives.jsx';
import { Input, Select, GradientButton } from '../components/ui/inputs.jsx';
import { useUI } from '../store/ui.js';

/** Profile — edit fields + location pin (spatial paradigm: 2dsphere user index). */
export default function Profile() {
  const { user, setUser } = useAuth();
  const pushToast = useUI((s) => s.pushToast);
  const [form, setForm] = useState({
    name: user.name, department: user.department || 'Computer Science',
    semester: user.semester, gradYear: user.gradYear || '', bio: user.bio || '',
  });
  const [locLabel, setLocLabel] = useState(user.location?.label || '');

  const save = useMutation({
    mutationFn: (payload) => api.patch('/users/me', payload),
    onSuccess: ({ data }) => {
      setUser(data.user);
      pushToast({ title: 'Profile saved ✓', variant: 'success' });
    },
    onError: (err) => pushToast({ title: 'Save failed', message: errMsg(err), variant: 'danger' }),
  });

  const pinLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      save.mutate({
        ...form,
        location: { coordinates: [pos.coords.longitude, pos.coords.latitude], label: locLabel || 'My campus spot' },
      });
    }, () => pushToast({ title: 'Location permission denied', variant: 'warning' }));
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-2xl">
      <SectionTitle title="Profile" subtitle="Your identity on campus + your spot for Near Me." />
      <GlassCard hover={false} className="p-6">
        <div className="mb-5 flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-aurora aurora-anim font-display text-2xl font-bold text-white shadow-glow">
            {user.name[0].toUpperCase()}
          </span>
          <div>
            <div className="font-display text-lg font-bold text-ink">{user.name}</div>
            <div className="text-xs text-ink-muted">{user.collegeEmail}</div>
            <div className="mt-1 flex gap-2">
              <Badge tone={user.role === 'admin' ? 'warning' : 'primary'}>{user.role}</Badge>
              <Badge tone={user.verified ? 'success' : 'danger'}>
                {user.verified ? 'verified ✓' : 'not verified'}
              </Badge>
            </div>
          </div>
        </div>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
          <Input label="Full name" value={form.name} onChange={set('name')} />
          <div className="grid grid-cols-3 gap-3">
            <Select label="Department" value={form.department} onChange={set('department')}
              options={['Computer Science', 'Electronics', 'Mechanical', 'Applied Sciences'].map((d) => ({ value: d, label: d }))} />
            <Input label="Semester" type="number" min="1" max="10" value={form.semester} onChange={set('semester')} />
            <Input label="Grad year" value={form.gradYear} onChange={set('gradYear')} />
          </div>
          <Input label="Bio" value={form.bio} onChange={set('bio')} placeholder="Tell campus what you trade…" />

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">My location (spatial index)</span>
              {user.location?.coordinates?.[0] !== 0 && (
                <Badge tone="success">{user.location?.coordinates?.[1]?.toFixed(4)}, {user.location?.coordinates?.[0]?.toFixed(4)}</Badge>
              )}
            </div>
            <Input value={locLabel} onChange={(e) => setLocLabel(e.target.value)} placeholder="Label e.g. Hostel B / Library" />
            <GradientButton type="button" size="sm" variant="outline" className="mt-3" onClick={pinLocation}>
              ⌖ Update my location pin
            </GradientButton>
          </div>

          <div className="flex justify-end">
            <GradientButton type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save profile'}
            </GradientButton>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}
