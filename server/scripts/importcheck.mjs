/**
 * Import-graph smoke test — imports every module (routes, services, models)
 * so ESM resolution errors surface without starting the HTTP server.
 * Run: node scripts/importcheck.mjs
 */
const B = '../src/';
const mods = [
  B + 'config/env.js', B + 'config/db.js',
  B + 'models/User.js', B + 'models/Resource.js', B + 'models/StudyMaterial.js',
  B + 'models/Transaction.js', B + 'models/Request.js', B + 'models/Review.js',
  B + 'models/Notification.js', B + 'models/ResourceHistory.js', B + 'models/DbEvent.js', B + 'models/Report.js',
  B + 'middleware/auth.js', B + 'middleware/error.js', B + 'middleware/upload.js',
  B + 'services/eventlog.service.js', B + 'services/notification.service.js',
  B + 'services/history.service.js', B + 'services/graph.service.js', B + 'services/graph.queries.js',
  B + 'services/active/engine.js', B + 'services/active/changeStreams.js', B + 'services/active/cron.js',
  B + 'routes/auth.routes.js', B + 'routes/users.routes.js', B + 'routes/resource.routes.js',
  B + 'routes/material.routes.js', B + 'routes/transaction.routes.js', B + 'routes/request.routes.js',
  B + 'routes/review.routes.js', B + 'routes/report.routes.js', B + 'routes/notification.routes.js',
  B + 'routes/graph.routes.js', B + 'routes/spatial.routes.js', B + 'routes/admin.routes.js', B + 'routes/system.routes.js',
];

let failed = 0;
for (const m of mods) {
  try {
    await import(m);
    console.log('ok   ' + m);
  } catch (err) {
    failed++;
    console.error('FAIL ' + m + ' → ' + err.message);
  }
}
console.log(failed ? `\n${failed} module(s) failed` : '\nALL MODULES IMPORT OK');
process.exit(0);
