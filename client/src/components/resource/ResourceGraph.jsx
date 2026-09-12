import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import api from '../../api/axios.js';
import { GlassCard, Badge } from '../ui/primitives.jsx';
import { theme } from '../../theme/theme.js';

const LABEL_COLOR = {
  Resource: theme.colors.primaryLight,
  Student: theme.colors.accentLight,
  Subject: theme.colors.cyan,
  Department: theme.colors.magenta,
};

/**
 * GRAPH PARADIGM visualization — force-directed traversal of the Neo4j
 * neighborhood around a resource. Nodes glow in label colors; edges label on hover.
 */
export default function ResourceGraph({ resourceId }) {
  const fgRef = useRef(null);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['graph', resourceId],
    queryFn: async () => (await api.get(`/graph/data/${resourceId}`)).data,
  });

  useEffect(() => {
    if (data?.data && fgRef.current) {
      fgRef.current.d3Force('charge').strength(-320);
      setTimeout(() => fgRef.current?.zoomToFit(380, 60), 900);
    }
  }, [data]);

  const graph = data?.data || { nodes: [], links: [] };

  const paintNode = (node, ctx, globalScale) => {
    const label = LABEL_COLOR[node.label] || theme.colors.text;
    const r = node.label === 'Resource' ? 7 : 5;
    // glow
    ctx.save();
    ctx.shadowColor = label;
    ctx.shadowBlur = 14;
    ctx.fillStyle = label;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    // core
    ctx.fillStyle = theme.colors.bg2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r - 2, 0, 2 * Math.PI);
    ctx.fill();
    // text
    if (globalScale > 0.7) {
      ctx.font = `${node.label === 'Resource' ? 600 : 400} ${4.4 / globalScale}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillStyle = theme.colors.text;
      const name = (node.name || '').length > 24 ? node.name.slice(0, 24) + '…' : node.name;
      ctx.fillText(name, node.x, node.y - r - 3 / globalScale);
    }
  };

  return (
    <GlassCard hover={false} className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5">
        <h3 className="font-display text-sm font-semibold text-ink">Knowledge graph neighborhood</h3>
        <Badge tone={data?.source === 'neo4j' ? 'accent' : 'warning'}>
          {data?.source === 'neo4j' ? 'Neo4j traversal' : 'Mongo fallback'}
        </Badge>
      </div>
      <div className="h-[380px] w-full">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Traversing the graph…</div>
        ) : graph.nodes?.length ? (
          <ForceGraph2D
            ref={fgRef}
            graphData={graph}
            nodeCanvasObject={paintNode}
            nodeLabel={(n) => `${n.label}: ${n.name}`}
            linkColor={() => 'rgba(139,92,246,0.45)'}
            linkWidth={1.2}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2.4}
            linkDirectionalParticleColor={() => theme.colors.accentLight}
            onNodeClick={(n) => n.label === 'Resource' && navigate(`/resources/${n.id.replace('r_', '')}`)}
            backgroundColor="rgba(0,0,0,0)"
          />
        ) : (
          <div className="grid h-full place-items-center text-sm text-ink-muted">Graph is empty — interact to grow it.</div>
        )}
      </div>
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
