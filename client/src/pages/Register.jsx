import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/axios.js';
import { useAuth } from '../store/auth.js';
import { GradientButton, Input, Select } from '../components/ui/inputs.jsx';
import BackgroundMesh from '../components/common/BackgroundMesh.jsx';
import { useUI } from '../store/ui.js';

export default function Register() {
  const [form, setForm] = useState({
    name: '', collegeEmail: '', password: '', department: 'Computer Science', semester: 5, gradYear: '2027',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const pushToast = useUI((s) => s.pushToast);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/register', form);
      setAuth({ user: data.user, token: data.token });
      pushToast({ title: 'Account created 🎉', message: 'Check the server console for your verification link (dev mailer).', variant: 'success', duration: 8000 });
      navigate('/dashboard');
    } catch (err) {
      setError(errMsg(err, 'Registration failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <BackgroundMesh />
      <div className="glass-strong w-full max-w-md rounded-3xl p-8">
        <Link to="/" className="mb-6 flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-aurora aurora-anim font-display text-lg font-bold text-white shadow-glow">C</div>
          <span className="font-display text-lg font-bold text-ink">Campus<span className="aurora-text">Xchange</span></span>
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Join your campus</h1>
        <p className="mt-1 text-sm text-ink-muted">Only college emails (.edu / .ac.in) can register.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input label="Full name" required value={form.name} onChange={set('name')} placeholder="Aisha Sharma" />
          <Input label="College email" type="email" required value={form.collegeEmail} onChange={set('collegeEmail')} placeholder="you@college.edu" />
          <Input label="Password" type="password" required minLength={6} value={form.password} onChange={set('password')} placeholder="min 6 chars" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Department" value={form.department} onChange={set('department')}
              options={['Computer Science', 'Electronics', 'Mechanical', 'Applied Sciences', 'Administration'].map((d) => ({ value: d, label: d }))} />
            <Input label="Semester" type="number" min="1" max="10" value={form.semester} onChange={set('semester')} />
          </div>
          <Input label="Graduation year" value={form.gradYear} onChange={set('gradYear')} placeholder="2027" />
          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <GradientButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating account…' : 'Create account'}
          </GradientButton>
        </form>

        <p className="mt-5 text-center text-xs text-ink-muted">
          Already have an account? <Link to="/login" className="text-primary-light hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
