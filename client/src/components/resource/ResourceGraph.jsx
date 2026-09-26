import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import api from '../../api/axios.js';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { theme } from '../../theme/theme.js';

const LABEL_COLOR = {
  Resource: theme.colors.primaryLight,
  Subject: theme.colors.cyan,
  Department: theme.colors.magenta,
  Student: theme.colors.accentLight,
};

const rid = (id) => String(id).replace(/^r_/, '');
const short = (s, n = 22) => (String(s || '').length > n ? `${String(s).slice(0, n)}…` : String(s || ''));

/**
 * GRAPH PARADIGM visualization — a compact force-directed view of the Neo4j
 * neighbourhood around one listing. The centre node is pinned, related products
 * orbit it, and clicking a product node reveals its details in the info panel
 * below the canvas (never a dead end — "open full listing" is always available).
 */
export default function ResourceGraph({ resourceId }) {
  const fgRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['graph', resourceId],
    queryFn: async () => (await api.get(`/graph/data/${resourceId}`)).data,
  });

  const graph = useMemo(() => {
    const raw = data?.data || { nodes: [], links: [] };
    const nodes = raw.nodes.map((n) => ({
      ...n,
      // Pin the centre listing so the layout is stable and readable.
      fx: rid(n.id) === String(resourceId) ? 0 : undefined,
      fy: rid(n.id) === String(resourceId) ? 0 : undefined,
    }));
    return { nodes, links: raw.links };
  }, [data, resourceId]);

  // Click a product node → fetch its full document for the info panel.
  const selectedId = selected && selected.label === 'Resource' ? rid(selected.id) : null;
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['resource', selectedId],
    queryFn: async () => (await api.get(`/resources/${selectedId}`)).data.resource,
    enabled: !!selectedId,
  });

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph.nodes.length) return;
    fg.d3Force('charge')?.strength(-140)?.distanceMax(260);
    fg.d3Force('link')?.distance((l) => (l.relType === 'IN_SUBJECT' ? 58 : 92));
    const t = setTimeout(() => fg.zoomToFit(600, 44), 800);
    return () => clearTimeout(t);
  }, [graph.nodes.length, graph.links.length]);

  const radiusOf = (n) => (n.label === 'Resource' ? (rid(n.id) === String(resourceId) ? 8.5 : 6) : 4.5);

  const paintNode = (node, ctx, globalScale) => {
    const color = LABEL_COLOR[node.label] || theme.colors.text;
    const isCenter = rid(node.id) === String(resourceId);
    const isSelected = selected && selected.id === node.id;
    const isHovered = hovered === node.id;
    const r = radiusOf(node) + (isHovered || isSelected ? 1.2 : 0);

    // Tight glow halo — keeps the canvas clean instead of a blob of light.
    if (isCenter || isSelected || isHovered) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Body: filled for the anchor/selection, hollow ring for the rest.
    ctx.fillStyle = isCenter || isSelected ? color : 'rgba(17,17,38,0.92)';
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.lineWidth = 1.6 / globalScale;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Labels only at readable zoom, products first.
    if (globalScale > 0.85 && (node.label === 'Resource' || globalScale > 1.4)) {
      const text = short(node.name, node.label === 'Resource' ? 20 : 14);
      ctx.font = `${isCenter ? 600 : 400} ${3.6 / globalScale}px Inter`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isCenter ? theme.colors.text : 'rgba(226,232,240,0.82)';
      ctx.fillText(text, node.x, node.y + r + 2 / globalScale);
    }
  };

  return (
    <GlassCard hover={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5">
        <h3 className="font-display text-sm font-semibold text-ink">Related products</h3>
        <Badge tone={data?.source === 'neo4j' ? 'accent' : 'warning'}>
          {data?.source === 'neo4j' ? 'Neo4j traversal' : 'Mongo fallback'}
        </Badge>
        <span className="ml-auto text-[11px] text-ink-muted">click a product node for details</span>
      </div>

      <div className="relative h-[340px] w-full">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Traversing the graph…</div>
        ) : graph.nodes?.length ? (
          <ForceGraph2D
            ref={fgRef}
            graphData={graph}
            cooldownTicks={140}
            warmupTicks={60}
            d3AlphaDecay={0.03}
            d3VelocityDecay={0.32}
            enableNodeDrag={false}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, radiusOf(node) + 5, 0, 2 * Math.PI);
              ctx.fill();
            }}
            onNodeHover={(n) => setHovered(n?.id || null)}
            onNodeClick={(n) => setSelected(n.label === 'Resource' ? n : null)}
            linkColor={() => 'rgba(139,92,246,0.35)'}
            linkWidth={1}
            linkDirectionalParticles={(l) => (l.relType === 'IN_SUBJECT' ? 1 : 0)}
            linkDirectionalParticleWidth={1.8}
            linkDirectionalParticleSpeed={0.004}
            linkDirectionalParticleColor={() => theme.colors.accentLight}
            backgroundColor="rgba(0,0,0,0)"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Graph is empty — interact to grow it.</div>
        )}

        {selected && (
          <button
            onClick={() => setSelected(null)}
            className="absolute right-3 top-3 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-ink-muted hover:text-ink"
          >
            clear ✕
          </button>
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
