import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import BackgroundMesh from '../components/common/BackgroundMesh.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import { GlassCard } from '../components/ui/primitives.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { useAuth } from '../store/auth.js';
import { PARADIGM_META } from '../theme/theme.js';

const FEATURES = [
  { p: 'mongodb', title: 'Document Store Core', body: 'Users, listings, materials, deals & reviews live in MongoDB collections with rich text filters.' },
  { p: 'graph', title: 'Graph Discovery', body: 'Neo4j traverses Student↔Resource↔Subject↔Department edges to power related-resource & collaborative recommendations, visualized as a glowing force-graph.' },
  { p: 'temporal', title: 'Lifecycle Time Machine', body: 'Every listing change (price, owner, lend/return) writes a validFrom/validTo versioned snapshot — browse any resource\u2019s full history timeline.' },
  { p: 'active', title: 'Event-Condition-Action', body: 'MongoDB Change Streams + node-cron trigger automation: availability alerts, overdue reminders, auto-flagging on reports — pushed live over Socket.io.' },
  { p: 'spatial', title: 'Spatial "Near Me"', body: 'A 2dsphere geospatial index and $near / $geoWithin queries surface resources & students around you on a live map.' },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <BackgroundMesh />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-aurora aurora-anim font-display text-lg font-bold text-white shadow-glow">C</div>
          <span className="font-display text-lg font-bold text-ink">Campus<span className="aurora-text">Xchange</span></span>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <Link to="/dashboard"><GradientButton size="sm">Open dashboard →</GradientButton></Link>
          ) : (
            <>
              <Link to="/login" className="text-sm text-ink-muted hover:text-ink">Sign in</Link>
              <Link to="/register"><GradientButton size="sm">Get started</GradientButton></Link>
            </>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-14 text-center sm:pt-20">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-6xl">
            The college-exclusive way to <span className="aurora-text aurora-anim">exchange knowledge</span> & resources
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-muted sm:text-lg">
            Sell, lend, exchange lab kits & textbooks — and share notes, papers and project references.
            Powered by MongoDB, Neo4j, a temporal layer, active automation and geospatial queries.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register"><GradientButton size="lg">Create free account</GradientButton></Link>
            <Link to="/how-it-works">
              <GradientButton size="lg" variant="outline">See how it works</GradientButton>
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-5"
        >
          {FEATURES.map((f, i) => (
            <GlassCard key={f.p} className="p-5 text-left" style={{ animationDelay: `${i * 0.4}s` }}>
              <div className="mb-3"><DbTechBadge paradigm={f.p} /></div>
              <h3 className="font-display text-sm font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{f.body}</p>
            </GlassCard>
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mx-auto mt-14 max-w-xl text-xs text-ink-muted/80"
        >
          {Object.values(PARADIGM_META).map((m) => m.label).join(' · ')}
        </motion.p>
      </section>
    </div>
  );
}
