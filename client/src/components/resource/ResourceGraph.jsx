import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import api from '../../api/axios.js';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { theme } from '../../theme/theme.js';
import { TAU, rid, layoutGraph } from '../../lib/graphLayout.js';

const LABEL_COLOR = {
  Resource: theme.colors.primaryLight,
  Subject: theme.colors.cyan,
  Department: theme.colors.magenta,
  Student: theme.colors.accentLight,
};

const short = (s, n = 22) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

/** Rounded-rect path helper (ctx.roundRect isn't in every browser yet). */
function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * GRAPH PARADIGM visualization — the Neo4j neighbourhood around one listing,
 * drawn as a clean labelled radial graph. The layout itself is a pure function
 * in ../../lib/graphLayout.js, so coordinates are pinned (always centred, always
 * filling the canvas) and never re-shuffle while you click around. Clicking a
 * product node shows its details below (with a link to the full listing), so the
 * graph is a real discovery surface instead of a dead end.
 */
export default function ResourceGraph({ resourceId }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['graph', resourceId],
    queryFn: async () => (await api.get(`/graph/data/${resourceId}`)).data,
  });

  const graph = useMemo(
    () => layoutGraph(data?.data || { nodes: [], links: [] }, resourceId),
    [data, resourceId]
  );

  // Click a product node → fetch its full document for the info panel.
  const selectedId = selected && selected.label === 'Resource' ? rid(selected.id) : null;
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['resource', selectedId],
    queryFn: async () => (await api.get(`/resources/${selectedId}`)).data.resource,
    enabled: !!selectedId,
  });

  /** Fit the whole ring into view; retried so it runs after the canvas mounts. */
  const fit = (duration = 400) => fgRef.current?.zoomToFit(duration, 56);

  useEffect(() => {
    if (!graph.nodes.length) return;
    const t1 = setTimeout(() => fit(0), 60);
    const t2 = setTimeout(() => fit(300), 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [graph.nodes.length, graph.links.length]);

  const zoomBy = (k) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(fg.zoom() * k, 350);
  };

  const isCenterNode = (n) => rid(n.id) === String(resourceId);
  const radiusOf = (n) =>
    n.label === 'Resource' ? (isCenterNode(n) ? 24 : 15)
      : n.label === 'Subject' ? 11
        : n.label === 'Department' ? 9 : 10;

  const nodeId = (end) => (end && typeof end === 'object' ? end.id : end);

  // Focus mode: with a product selected, everything unrelated fades back so the
  // selected product and its connections read at a glance.
  const focus = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected.id]);
    graph.links.forEach((l) => {
      if (nodeId(l.source) === selected.id) set.add(nodeId(l.target));
      if (nodeId(l.target) === selected.id) set.add(nodeId(l.source));
    });
    return set;
  }, [selected, graph.links]);

  const linkColor = (l) => {
    const s = nodeId(l.source);
    const t = nodeId(l.target);
    const active = selected && (s === selected.id || t === selected.id);
    if (active) return 'rgba(196,181,253,0.9)';
    if (selected) return 'rgba(139,92,246,0.10)';
    return l.relType === 'IN_SUBJECT' ? 'rgba(139,92,246,0.5)' : 'rgba(217,70,239,0.32)';
  };

  const paintNode = (node, ctx, globalScale) => {
    const color = LABEL_COLOR[node.label] || theme.colors.text;
    const isCenter = isCenterNode(node);
    const isSelected = selected && selected.id === node.id;
    const isHovered = hovered === node.id;
    const r = radiusOf(node) + (isHovered || isSelected ? 2 : 0);
    const faded = focus && !focus.has(node.id);

    ctx.save();
    ctx.globalAlpha = faded ? 0.24 : 1;

    // Halo — the visual anchor that makes the graph read as "graph".
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = isCenter ? 26 : isHovered || isSelected ? 20 : 12;
    ctx.fillStyle = isCenter ? color : 'rgba(17,17,38,0.96)';
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Ring
    ctx.lineWidth = (isCenter ? 2.6 : 2) / globalScale;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, TAU);
    ctx.stroke();

    // Inner dot for the anchor / selection
    if (isCenter || isSelected) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 0.34, 0, TAU);
      ctx.fill();
    }

    // Label pill — constant on-screen size, always legible over the links.
    const label = short(node.name, isCenter ? 30 : 24);
    const fs = (isCenter ? 13 : node.label === 'Resource' ? 12 : 10.5) / globalScale;
    ctx.font = `${isCenter ? 700 : 500} ${fs}px Inter, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const padX = 6 / globalScale;
    const lh = fs * 1.5;
    const lx = node.x - tw / 2 - padX;
    const ly = node.y + r + 4 / globalScale;

    ctx.fillStyle = isCenter ? 'rgba(139,92,246,0.32)' : 'rgba(9,9,26,0.82)';
    pill(ctx, lx, ly, tw + padX * 2, lh, lh / 2.4);
    ctx.fill();
    ctx.lineWidth = 1 / globalScale;
    ctx.strokeStyle = isCenter ? color : 'rgba(255,255,255,0.12)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isCenter ? '#FFFFFF' : isHovered || isSelected ? '#FFFFFF' : 'rgba(226,232,240,0.94)';
    ctx.fillText(label, node.x, ly + lh / 2);
    ctx.restore();
  };

  const productCount = graph.nodes.filter((n) => n.label === 'Resource').length - 1;
  const hubCount = graph.nodes.length - productCount - 1;

  return (
    <GlassCard hover={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5">
        <h3 className="font-display text-sm font-semibold text-ink">Related products</h3>
        <Badge tone={data?.source === 'neo4j' ? 'accent' : 'warning'}>
          {data?.source === 'neo4j' ? 'Neo4j traversal' : 'Mongo fallback'}
        </Badge>
        {productCount > 0 && (
          <span className="text-[11px] text-ink-muted">
            {productCount} product{productCount === 1 ? '' : 's'} · {hubCount} hub{hubCount === 1 ? '' : 's'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {productCount > 0 && (
            <span className="hidden text-[11px] text-ink-muted sm:inline">click a product node for details</span>
          )}
          <button onClick={() => zoomBy(1 / 1.35)} title="Zoom out" disabled={productCount === 0}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-ink-muted hover:border-accent/50 hover:text-ink disabled:opacity-40">
            −
          </button>
          <button onClick={() => fit(400)} title="Fit to view" disabled={productCount === 0}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-[10px] text-ink-muted hover:border-accent/50 hover:text-ink disabled:opacity-40">
            ⤢
          </button>
          <button onClick={() => zoomBy(1.35)} title="Zoom in" disabled={productCount === 0}
            className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm text-ink-muted hover:border-accent/50 hover:text-ink disabled:opacity-40">
            ＋
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-2 h-[460px] w-full">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Traversing the graph…</div>
        ) : productCount > 0 ? (
          <ForceGraph2D
            ref={fgRef}
            graphData={graph}
            // Nodes are laid out deterministically, so the engine has nothing to
            // solve — these settings only guarantee an immediate, stable paint.
            cooldownTicks={1}
            warmupTicks={1}
            d3AlphaDecay={1}
            d3VelocityDecay={1}
            minZoom={0.35}
            maxZoom={8}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
            nodeRelSize={1}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              // Generous hit area — the label pill is clickable too.
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, radiusOf(node) + 10, 0, TAU);
              ctx.fill();
            }}
            onNodeHover={(n) => setHovered(n?.id || null)}
            onNodeClick={(n) => setSelected(n.label === 'Resource' ? n : null)}
            onBackgroundClick={() => setSelected(null)}
            linkColor={linkColor}
            linkWidth={1.6}
            linkCurvature={0.06}
            linkDirectionalParticles={(l) => (l.relType === 'IN_SUBJECT' ? 2 : 0)}
            linkDirectionalParticleWidth={2.6}
            linkDirectionalParticleSpeed={0.003}
            linkDirectionalParticleColor={() => theme.colors.accentLight}
            backgroundColor="rgba(0,0,0,0)"
          />
        ) : graph.nodes?.length ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <div className="text-2xl opacity-60">⇄</div>
              <p className="mt-3 text-sm text-ink">No related products yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-ink-muted">
                Nothing else in {graph.nodes.find((n) => n.label === 'Subject')?.name || 'this subject'} is listed
                right now. As more students post, the graph grows around this listing.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Graph is empty — interact to grow it.</div>
        )}
      </div>
      {/* ---- Selected product info panel (no navigation required) ---- */}
      {selectedId && (
        <div className="border-t border-white/8 px-5 py-4">
          {detailLoading ? (
            <div className="text-xs text-ink-muted">Loading product details…</div>
          ) : detail ? (
            <div className="flex flex-wrap items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-aurora font-display text-base font-bold text-white">
                {detail.title?.[0]?.toUpperCase() || '?'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-semibold text-ink">{detail.title}</span>
                  <Badge tone={detail.availability === 'available' ? 'success' : 'warning'}>{detail.availability}</Badge>
                  <Badge tone="primary">{detail.category}</Badge>
                  <Badge tone="accent">{detail.listingType}</Badge>
                </div>
                <div className="mt-1 text-[11px] text-ink-muted">
                  {detail.subject || detail.category} · {detail.department || 'General'}
                  {detail.semester ? ` · Sem ${detail.semester}` : ''} · {detail.condition}
                  {detail.location?.label ? ` · ⌖ ${detail.location.label}` : ''}
                  {detail.ratingCount ? ` · ${detail.ratingAvg}★ (${detail.ratingCount})` : ''}
                </div>
                {detail.description && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted">{detail.description}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="font-display text-lg font-bold aurora-text">
                  {detail.listingType === 'sell' ? `₹${detail.price}`
                    : detail.listingType === 'donate' ? 'Free'
                    : detail.listingType === 'exchange' ? 'Exchange' : 'Lend'}
                </span>
                <Link
                  to={`/resources/${detail._id}`}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-primary-light hover:border-accent/50"
                >
                  open full listing →
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-xs text-ink-muted">That product is no longer listed.</div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-white/8 px-5 py-3 text-[10px] text-ink-muted">
        {Object.entries(LABEL_COLOR).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            {label}
          </span>
        ))}
      </div>
    </GlassCard>
  );
}
