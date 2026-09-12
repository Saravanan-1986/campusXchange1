import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './store/auth.js';
import { connectSocket, disconnectSocket } from './lib/socket.js';
import AppShell from './components/layout/AppShell.jsx';
import { PageTransition } from './components/ui/primitives.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Verify from './pages/Verify.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Marketplace from './pages/Marketplace.jsx';
import ResourceDetail from './pages/ResourceDetail.jsx';
import CreateResource from './pages/CreateResource.jsx';
import KnowledgeHub from './pages/KnowledgeHub.jsx';
import MaterialDetail from './pages/MaterialDetail.jsx';
import NearMe from './pages/NearMe.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import NotFound from './pages/NotFound.jsx';

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
  );
}
