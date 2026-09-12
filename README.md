# 🎓 CampusXchange

**College-exclusive academic resource & knowledge sharing platform** — built as an
Advanced Database Management Systems showcase where **five database paradigms** work
together inside one real MERN product.

| Paradigm | Implementation | Where to see it |
|---|---|---|
| **MongoDB** (document store) | Mongoose models: User, Resource, StudyMaterial, Transaction, Request, Review, Notification, Report | Whole app; filters, facets, text search |
| **Neo4j** (graph) | `Student-[:OWNS]→Resource-[:IN_SUBJECT]→Subject-[:BELONGS_TO]→Department` + `REVIEWED / REQUESTED / USED` edges, synced on every write; Cypher traversals for recommendations (Mongo fallback if Neo4j is down) | Resource page → **Related Graph** tab (force-directed, glowing nodes) |
| **Temporal** (design pattern on MongoDB) | `ResourceHistory` with **validFrom / validTo** intervals + `recordedAt` transaction time (bi-temporal), versioned on every state change; previous owners anonymized (`A*** S***`) | Resource page → **History Timeline** tab |
| **Active DB** (ECA + triggers) | **MongoDB Change Streams** on `resources`/`transactions` (auto polling-fallback on standalone mongod), **node-cron** overdue reminders + heartbeat, ECA rules engine (`notify-on-availability`, `transaction-lifecycle-notify`, `report-auto-flag`) → **Socket.io** live toasts + notification center | Bell badge / toasts; Admin → **DB Monitor** live feed |
| **Spatial** (geospatial) | **2dsphere** indexes on users & resources; `$near` / `$geoWithin($centerSphere)` queries | **Near Me** page (Leaflet map, glass markers, radius slider) |

Every feature is annotated with paradigm comments in code, and the in-app
**How it works** page (`/how-it-works`) is the demo script for the viva.

## Tech stack

- **Client** — React 18 (Vite), React Router 6, Zustand (auth/ui), TanStack Query, Axios, Framer Motion, Tailwind CSS 3 (config-driven glassmorphism theme), react-force-graph-2d, react-leaflet, socket.io-client
- **Server** — Node.js + Express, Mongoose, neo4j-driver, socket.io, node-cron, Multer (local uploads), JWT auth with college-email verification + roles (student/admin)

## Quick start

```bash
# 1) install everything
npm run install-all

# 2) configure databases (defaults in server/.env)
#    - MongoDB: mongodb://127.0.0.1:27017/campusxchange
#    - Neo4j:   bolt://localhost:7687 (optional — recommendations gracefully fall back to Mongo)

# 3) seed demo data (campus geo-center is set in server/src/seed/data.js)
npm run seed

# 4) run both (server :8044 + client :6390)
npm run dev
```

**Demo logins** (after seeding) — password `Passw0rd!`:

| Role | Email |
|---|---|
| admin | `admin@campusxchange.edu` |
| student | `aisha@campusxchange.edu` |
| student | `rohan@campusxchange.edu` |
| student | `meera@campusxchange.edu` |

> Email verification: the dev "mailer" prints the verification link to the server
> console, and the register response includes a `devToken` shortcut.
> Change Streams require a MongoDB **replica set**; on a standalone `mongod` the
> Active layer automatically switches to a 30s polling fallback and the monitor
> shows `activeChangeStreams: polling-fallback`.

## Viva demo script (5 minutes)

1. **MongoDB** — Browse the Marketplace, filter by price/condition/availability.
2. **Temporal** — Open *Operating Systems — Galvin* → **History Timeline** tab: v1 listed ₹350 → v2 price ₹300 (validFrom/validTo intervals).
3. **Graph** — Same resource → **Related Graph** tab: Neo4j neighborhood (Student/Subject/Department nodes). Then *Deal* with another student → `USED` edges grow the collaborative graph.
4. **Active** — From another account, click **👀 Alert me when available** on an unavailable listing. Owner marks it available → ECA rule fires → live toast + notification. Overdue lend from the seed gets flagged by cron within a minute.
5. **Spatial** — **Near Me** page: radius slider runs `$geoWithin` on the 2dsphere index.
6. **Admin** — `/admin` → **DB Monitor**: live event feed from all five paradigms (Socket.io `db:event`).

## Design system

Glassmorphism, dark-mode-first: deep-space navy (`#0B0B1E → #14142B`), electric blue +
violet duotone with an aurora gradient, cyan/amber/rose accents. Palette lives in
**two mirrored files** — `client/src/index.css` (CSS variables, runtime) and
`client/src/theme/theme.js` (JS tokens for canvas) — plus `client/tailwind.config.js`.

## Structure

```
├── client/            # Vite + React + Tailwind glassmorphism UI
│   └── src/{api,store,lib,theme,components/{ui,layout,common,resource,material},pages}
└── server/
    ├── src/config/    # env, MongoDB connection
    ├── src/models/    # 10 Mongoose collections (incl. ResourceHistory, DbEvent)
    ├── src/routes/    # auth, users, resources, materials, transactions,
    │                  # requests, reviews, reports, notifications, graph,
    │                  # spatial, admin, system
    ├── src/services/  # history (temporal), graph (+queries), active/{engine,changeStreams,cron},
    │                  # notification, eventlog
    ├── src/sockets/   # Socket.io (user rooms + admin db:event feed)
    └── src/seed/      # demo data seeder
```
