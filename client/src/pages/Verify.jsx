import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/axios.js';
import { useAuth } from '../store/auth.js';
import { GradientButton } from '../components/ui/inputs.jsx';
import BackgroundMesh from '../components/common/BackgroundMesh.jsx';

/** College-email verification — consumes the token from the dev mailer link. */
export default function Verify() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'pending', message: '' });
  const navigate = useNavigate();
  const { setUser, user } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState({ status: 'error', message: 'No verification token in URL.' });
      return;
    }
    api.post('/auth/verify', { token })
      .then(({ data }) => {
        setState({ status: 'ok', message: `${data.user.name} verified ✅` });
        if (user && data.user.id === user.id) setUser({ ...user, verified: true });
      })
      .catch((err) => setState({ status: 'error', message: errMsg(err) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <BackgroundMesh />
      <div className="glass-strong w-full max-w-md rounded-3xl p-8 text-center">
        <div className="mb-4 text-5xl">{state.status === 'pending' ? '✉' : state.status === 'ok' ? '✅' : '⚠'}</div>
        <h1 className="font-display text-2xl font-bold text-ink">
          {state.status === 'pending' ? 'Verifying…' : state.status === 'ok' ? 'Email verified' : 'Verification failed'}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{state.message || 'Checking your college email token…'}</p>
        <GradientButton className="mt-6" onClick={() => navigate('/dashboard')}>Go to dashboard</GradientButton>
      </div>
    </div>
  );
}
