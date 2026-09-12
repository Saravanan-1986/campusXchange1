import { Link } from 'react-router-dom';
import { GlassCard, SectionTitle, Badge } from '../components/ui/primitives.jsx';
import DbTechBadge from '../components/common/DbTechBadge.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';

const MAP = [
  {
    paradigm: 'mongodb',
    title: 'MongoDB — Document Store (primary data)',
    features: [
      ['Users, Resources, StudyMaterials, Transactions, Requests, Reviews, Notifications', 'Mongoose schemas in server/src/models'],
      ['Full-text + facet search & filters', 'server/src/routes/resource.routes.js ($text, multi-filter)'],
      ['Knowledge Hub browse tree (dept→sem→subject→type)', 'server/src/routes/material.routes.js (aggregation facets)'],
    ],
  },
  {
    paradigm: 'graph',
    title: 'Neo4j — Graph Database (relationships & discovery)',
    features: [
      ['Entity sync on every write: Student-[:OWNS]→Resource-[:IN_SUBJECT]→Subject-[:BELONGS_TO]→Department', 'server/src/services/graph.service.js (Cypher MERGE)'],
      ['"Related resources" traversal + "students who used this also used"', 'server/src/services/graph.queries.js'],
      ['Interactive force-directed graph with glowing nodes', 'client/src/components/resource/ResourceGraph.jsx'],
      ['REVIEWED / REQUESTED / USED edges from reviews & deals', 'review.routes.js + transaction.routes.js'],
    ],
  },
  {
    paradigm: 'temporal',
    title: 'Temporal Layer — versioned lifecycle (valid time + transaction time)',
    features: [
      ['ResourceHistory: validFrom/validTo snapshots + recordedAt (bi-temporal)', 'server/src/models/ResourceHistory.js'],
      ['Auto-recorded on: create, edit, price change, lend/return, ownership transfer', 'server/src/services/history.service.js'],
      ['Visual per-resource timeline, previous owners anonymized (A*** S***)', 'client/src/components/resource/Timeline.jsx'],
    ],
  },
  {
    paradigm: 'active',
    title: 'Active DB — Event-Condition-Action automation',
    features: [
      ['MongoDB Change Streams on resources + transactions (polling fallback on standalone mongod)', 'server/src/services/active/changeStreams.js'],
      ['ECA rules: notify-on-availability, transaction-lifecycle-notify, report-auto-flag (N=3)', 'server/src/services/active/engine.js'],
      ['node-cron: overdue lend reminders every minute + heartbeat', 'server/src/services/active/cron.js'],
      ['Live delivery: Socket.io toasts + notification center + admin db:event feed', 'server/src/sockets/index.js, client/src/lib/socket.js'],
    ],
  },
  {
    paradigm: 'spatial',
    title: 'Spatial — geospatial queries',
    features: [
      ['2dsphere indexes on User.location & Resource.location', 'models (schema index) '],
      ['$geoWithin/$centerSphere radius search + $near for students', 'server/src/routes/spatial.routes.js'],
      ['Leaflet map with glass markers + live radius circle', 'client/src/pages/NearMe.jsx'],
    ],
  },
];

/** Dev/viva panel — maps every visible feature back to its database paradigm. */
export default function HowItWorks() {
  return (
    <div>
      <SectionTitle
        title="How it works — the 5-database tour"
        subtitle="Every feature you interact with maps to one of five database paradigms. This panel is the demo script."
      />
      <div className="space-y-5">
        {MAP.map((m) => (
          <GlassCard key={m.paradigm} hover={false} className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-ink">{m.title}</h3>
              <DbTechBadge paradigm={m.paradigm} tag />
            </div>
            <div className="space-y-2.5">
              {m.features.map(([feat, where]) => (
                <div key={feat} className="flex flex-col gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm text-ink">{feat}</span>
                  <code className="text-[11px] text-primary-light/90">{where}</code>
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
      <GlassCard hover={false} className="mt-6 p-5 text-center">
        <p className="text-xs text-ink-muted">
          Live verification: open the <Link to="/admin" className="text-primary-light hover:underline">Admin → DB Monitor</Link> and
          trigger actions (subscribe to an unavailable listing, complete a deal, file reports) to watch events stream in.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block"><GradientButton size="sm" variant="outline">Try it →</GradientButton></Link>
      </GlassCard>
    </div>
  );
}
