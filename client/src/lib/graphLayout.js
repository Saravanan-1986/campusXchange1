/**
 * Deterministic radial layout for the "Related products" graph (Neo4j-derived
 * node/link data). Kept as a pure function so it is unit-testable and so the
 * picture never depends on a force simulation:
 *
 *   centre      = the listing you are viewing (pinned at the origin)
 *   inner ring  = its Subject / Department hubs
 *   outer ring  = every related product, spread evenly by angle
 *
 * x/y are set alongside fx/fy so the renderer draws nodes exactly there even
 * with the simulation stopped; dragging still works (d3 rewrites fx/fy) and the
 * "fit" button restores the ring.
 */
export const TAU = Math.PI * 2;

/** Outer ellipse for products — wide and flat, to match the wide detail card. */
export const OUT = { x: 410, y: 158 };
/** Inner ellipse for Subject / Department hubs. */
export const MID = { x: 195, y: 84 };
/** Departments sit between their hub and the product ring. */
export const DEPT = 1.5;

export const rid = (id) => String(id).replace(/^r_/, '');

export function layoutGraph(raw, centerId) {
  const nodes = (raw?.nodes || []).map((n) => ({ ...n }));
  const links = (raw?.links || []).map((l) => ({ ...l }));
  const center = nodes.find((n) => rid(n.id) === String(centerId)) || nodes[0];
  if (!center) return { nodes, links };

  const products = nodes.filter((n) => n.label === 'Resource' && n !== center);
  const hubs = nodes.filter((n) => n.label === 'Subject');
  const depts = nodes.filter((n) => n.label === 'Department');
  const rest = nodes.filter((n) => ![center, ...products, ...hubs, ...depts].includes(n));

  const place = (n, x, y) => { n.x = x; n.y = y; n.fx = x; n.fy = y; };

  place(center, 0, 0);

  const hubAngle = new Map();
  hubs.forEach((h, i) => {
    const a = (TAU * i) / hubs.length - Math.PI / 2;
    hubAngle.set(h.id, a);
    place(h, Math.cos(a) * MID.x, Math.sin(a) * MID.y);
  });

  // Each department sits between the subject hub it belongs to and the ring.
  depts.forEach((d, i) => {
    const link = links.find((l) => l.source === d.id || l.target === d.id);
    const hubId = link ? (link.source === d.id ? link.target : link.source) : null;
    const a = hubAngle.get(hubId) ?? (TAU * i) / Math.max(1, depts.length) + Math.PI / 4;
    place(d, Math.cos(a) * MID.x * DEPT, Math.sin(a) * MID.y * DEPT);
  });

  rest.forEach((o, i) => {
    const a = (TAU * i) / Math.max(1, rest.length) + Math.PI;
    place(o, Math.cos(a) * OUT.x * 0.78, Math.sin(a) * OUT.y * 0.78);
  });

  // Outer ring: with one product keep it on the horizontal axis (a lone node at
  // 6 o'clock would collapse the picture into a vertical line); otherwise start
  // at "12 o'clock" offset by half a step so product labels never collide.
  const n = products.length || 1;
  products.forEach((p, i) => {
    let a;
    if (n === 1) a = 0;
    else if (n === 2) a = i * Math.PI;
    else a = -Math.PI / 2 + TAU / (2 * n) + (TAU * i) / n;
    place(p, Math.cos(a) * OUT.x, Math.sin(a) * OUT.y);
  });

  return { nodes, links };
}
