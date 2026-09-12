import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api, { errMsg } from '../api/axios.js';
import { useAuth } from '../store/auth.js';
import { GradientButton, Input } from '../components/ui/inputs.jsx';
import BackgroundMesh from '../components/common/BackgroundMesh.jsx';
import { useUI } from '../store/ui.js';

export default function Login() {
  const [form, setForm] = useState({ collegeEmail: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUI((s) => s.pushToast);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', form);
      setAuth(data);
      pushToast({ title: `Welcome back, ${data.user.name.split(' ')[0]}!`, variant: 'success' });
      navigate(location.state?.from || '/dashboard');
    } catch (err) {
      setError(errMsg(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <BackgroundMesh />
      <div className="glass-strong w-full max-w-md rounded-3xl p-8">
        <Link to="/" className="mb-6 flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-aurora aurora-anim font-display text-lg font-bold text-white shadow-glow">C</div>
          <span className="font-display text-lg font-bold text-ink">Campus<span className="aurora-text">Xchange</span></span>
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-muted">Sign in with your college email.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <Input
            label="College email" type="email" required placeholder="you@college.edu"
            value={form.collegeEmail}
            onChange={(e) => setForm({ ...form, collegeEmail: e.target.value })}
          />
          <Input
            label="Password" type="password" required placeholder="••••••••"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <GradientButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </GradientButton>
        </form>

        <p className="mt-5 text-center text-xs text-ink-muted">
          New here? <Link to="/register" className="text-primary-light hover:underline">Create an account</Link>
        </p>
        <p className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-center text-[11px] text-ink-muted">
          Demo: <code className="text-primary-light">aisha@campusxchange.edu</code> · <code className="text-primary-light">admin@campusxchange.edu</code> · Passw0rd!
        </p>
      </div>
    </div>
  );
}
