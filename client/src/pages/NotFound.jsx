import { Link } from 'react-router-dom';
import { GradientButton } from '../components/ui/inputs.jsx';
import BackgroundMesh from '../components/common/BackgroundMesh.jsx';

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <BackgroundMesh />
      <div className="text-7xl font-display font-bold aurora-text">404</div>
      <p className="mt-3 text-sm text-ink-muted">This page drifted out of orbit.</p>
      <Link to="/" className="mt-6"><GradientButton>Back home</GradientButton></Link>
    </div>
  );
}
