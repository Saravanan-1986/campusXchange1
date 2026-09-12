import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import AppShell from './components/layout/AppShell.jsx';
import { PageTransition, Spinner } from './components/ui/primitives.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Verify from './pages/Verify.jsx';

// Heavy pages (leaflet, force-graph, big forms) load on demand — keeps the
// first paint fast and isolates any import failure to its own route.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Marketplace = lazy(() => import('./pages/Marketplace.jsx'));
const ResourceDetail = lazy(() => import('./pages/ResourceDetail.jsx'));
const CreateResource = lazy(() => import('./pages/CreateResource.jsx'));
const KnowledgeHub = lazy(() => import('./pages/KnowledgeHub.jsx'));
const MaterialDetail = lazy(() => import('./pages/MaterialDetail.jsx'));
const NearMe = lazy(() => import('./pages/NearMe.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const HowItWorks = lazy(() => import('./pages/HowItWorks.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

function BootScreen() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8" />
        <span className="font-display text-xs uppercase tracking-[0.3em] text-ink-muted">CampusXchange</span>
      </div>
    </div>
  );
}

function RequireAuth({ children, admin = false }) {
  const { user, token } = useAuth();
  const location = useLocation();
  if (!token || !user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { token, user } = useAuth();
  useEffect(() => {
    if (token) connectSocket();
    else disconnectSocket();
  }, [token]);

  return (
    <Suspense fallback={<BootScreen />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={token && user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/register" element={token && user ? <Navigate to="/dashboard" replace /> : <Register />} />
        <Route path="/verify" element={<Verify />} />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/dashboard" element={<PageTransition><Dashboard /></PageTransition>} />
          <Route path="/resources" element={<PageTransition><Marketplace /></PageTransition>} />
          <Route path="/resources/new" element={<PageTransition><CreateResource /></PageTransition>} />
          <Route path="/resources/:id" element={<PageTransition><ResourceDetail /></PageTransition>} />
          <Route path="/materials" element={<PageTransition><KnowledgeHub /></PageTransition>} />
          <Route path="/materials/new" element={<PageTransition><KnowledgeHub /></PageTransition>} />
          <Route path="/materials/:id" element={<PageTransition><MaterialDetail /></PageTransition>} />
          <Route path="/near-me" element={<PageTransition><NearMe /></PageTransition>} />
          <Route path="/notifications" element={<PageTransition><Notifications /></PageTransition>} />
          <Route path="/profile" element={<PageTransition><Profile /></PageTransition>} />
          <Route path="/how-it-works" element={<PageTransition><HowItWorks /></PageTransition>} />
          <Route path="/admin" element={<RequireAuth admin><PageTransition><Admin /></PageTransition></RequireAuth>} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
