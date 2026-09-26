/**
 * CampusXchange design tokens — JS mirror of the CSS variables in index.css.
 * Violet futuristic glass: deep violet-black base, violet→purple→magenta aurora.
 */
export const theme = {
  colors: {
    bg1: '#0C081C',
    bg2: '#180E34',
    bg3: '#221644',
    primary: '#8B5CF6',
    primaryLight: '#C4B5FD',
    accent: '#8B5CF6',
    accentLight: '#A855F7',
    magenta: '#F0ABFC',
    cyan: '#22D3EE',
    amber: '#F59E0B',
    rose: '#F43F5E',
    text: '#EDE9FE',
    muted: '#A797D7',
    glass: 'rgba(24, 14, 52, 0.62)',
    glassBorder: 'rgba(168, 85, 247, 0.28)',
  },
  // Aurora gradient: lavender → violet → magenta
  aurora: 'linear-gradient(120deg, #DDD6FE 0%, #A855F7 50%, #F0ABFC 100%)',
  glow: (hex, blur = 18) => `0 0 ${blur}px ${hex}`,
};

export const PARADIGM_META = {
  mongodb: { label: 'MongoDB', color: theme.colors.primaryLight, tag: 'Document Store' },
  graph: { label: 'Neo4j Graph', color: theme.colors.accentLight, tag: 'Relationships' },
  temporal: { label: 'Temporal', color: theme.colors.cyan, tag: 'Valid-time History' },
  active: { label: 'Active DB', color: theme.colors.amber, tag: 'ECA + Cron' },
  spatial: { label: 'Spatial', color: theme.colors.magenta, tag: 'Geo Queries' },
};
