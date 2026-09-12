import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import ToastHost from '../common/ToastHost.jsx';
import { useUI } from '../../store/ui.js';

/** AppShell — glass sidebar + topbar + toast host around routed pages. */
export default function AppShell() {
  const { sidebarOpen } = useUI();
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={`transition-all duration-300 ${sidebarOpen ? 'ml-60' : 'ml-[68px]'}`}>
        <Topbar />
        <main className="mx-auto max-w-7xl px-4 py-7 sm:px-8">
          <Outlet />
        </main>
        <footer className="px-8 pb-8 pt-2 text-center text-[11px] text-ink-muted/70">
          CampusXchange · MongoDB · Neo4j · Temporal · Active DB · Spatial — built for Advanced DBMS
        </footer>
      </div>
      <ToastHost />
    </div>
  );
}
