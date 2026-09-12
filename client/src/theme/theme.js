/**
 * CampusXchange design tokens — JS mirror of the CSS variables in index.css.
 * Used where CSS vars can't go (canvas rendering in the force graph, toast configs).
 * Tweak palette here + in index.css (kept in sync intentionally).
 */
export const theme = {
  colors: {
    bg1: '#0B0B1E',
    bg2: '#14142B',
    bg3: '#1E1E3D',
    primary: '#3B82F6',
    primaryLight: '#60A5FA',
    accent: '#8B5CF6',
    accentLight: '#A855F7',
    magenta: '#D946EF',
    cyan: '#22D3EE',
    amber: '#F59E0B',
    rose: '#F43F5E',
    text: '#E2E8F0',
    muted: '#94A3B8',
    glass: 'rgba(20, 20, 43, 0.55)',
    glassBorder: 'rgba(255, 255, 255, 0.09)',
  },
  // Aurora gradient: blue → violet → magenta
  aurora: 'linear-gradient(120deg, #3B82F6 0%, #8B5CF6 50%, #D946EF 100%)',
  glow: (hex, blur = 18) => `0 0 ${blur}px ${hex}`,
};

export const PARADIGM_META = {
  mongodb: { label: 'MongoDB', color: theme.colors.primaryLight, tag: 'Document Store' },
  graph: { label: 'Neo4j Graph', color: theme.colors.accentLight, tag: 'Relationships' },
  temporal: { label: 'Temporal', color: theme.colors.cyan, tag: 'Valid-time History' },
  active: { label: 'Active DB', color: theme.colors.amber, tag: 'ECA + Cron' },
  spatial: { label: 'Spatial', color: theme.colors.magenta, tag: 'Geo Queries' },
};
