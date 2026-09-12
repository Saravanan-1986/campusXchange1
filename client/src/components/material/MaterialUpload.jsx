import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../../api/axios.js';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { Input, Select, Textarea, GradientButton } from '../ui/inputs.jsx';
import DbTechBadge from '../common/DbTechBadge.jsx';
import { useUI } from '../../store/ui.js';

const TYPES = ['notes', 'question-paper', 'lab-manual', 'project-reference', 'other'];

/** Upload flow — Multer on the server stores the PDF; metadata in MongoDB. */
export default function MaterialUpload({ onDone }) {
  const [form, setForm] = useState({ title: '', type: 'notes', department: 'Computer Science', semester: 5, subject: '', description: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const pushToast = useUI((s) => s.pushToast);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', file);
      return api.post('/materials', fd);
    },
    onSuccess: () => {
      pushToast({ title: 'Material published 📚', message: 'Stored via Multer; metadata indexed in MongoDB.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['materials'] });
      onDone?.();
    },
    onError: (err) => setError(errMsg(err, 'Upload failed')),
  });

  return (
    <GlassCard hover={false} className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-ink">Upload to Knowledge Hub</h3>
        <DbTechBadge paradigm="mongodb" tag />
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (!file) return setError('Choose a PDF or image file'); mutation.mutate(); }}
      >
        <Input label="Title" required value={form.title} onChange={set('title')} placeholder="DBMS Unit 3-5 handwritten notes" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Select label="Type" value={form.type} onChange={set('type')} options={TYPES.map((t) => ({ value: t, label: t }))} />
          <Select label="Department" value={form.department} onChange={set('department')}
            options={['Computer Science', 'Electronics', 'Mechanical', 'Applied Sciences'].map((d) => ({ value: d, label: d }))} />
          <Input label="Semester" type="number" min="1" max="10" value={form.semester} onChange={set('semester')} />
          <Input label="Subject" value={form.subject} onChange={set('subject')} placeholder="Database Systems" />
        </div>
        <Textarea label="Description" value={form.description} onChange={set('description')} placeholder="What does it cover?" className="min-h-[64px]" />
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">File (PDF / image, ≤10MB)</span>
          <input
            type="file" accept="application/pdf,image/*" required
            onChange={(e) => setFile(e.target.files[0])}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/20 file:px-3 file:py-1 file:text-xs file:text-primary-light"
          />
        </div>
        {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          {onDone && <GradientButton type="button" variant="ghost" onClick={onDone}>Cancel</GradientButton>}
          <GradientButton type="submit" disabled={mutation.isPending || !file}>
            {mutation.isPending ? 'Uploading…' : 'Publish material'}
          </GradientButton>
        </div>
      </form>
    </GlassCard>
  );
}
