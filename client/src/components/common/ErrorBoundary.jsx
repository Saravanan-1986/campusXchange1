import React from 'react';

/**
 * Root ErrorBoundary — a crash anywhere in the tree now renders a readable
 * glass panel (with the real error + a reset button) instead of a blank page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[CampusXchange crash]', error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'linear-gradient(160deg, #0B0B1E, #14142B)',
      }}>
        <div style={{
          maxWidth: 720, width: '100%', borderRadius: 20, padding: 28,
          background: 'rgba(20,20,43,0.82)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(244,63,94,0.45)',
          boxShadow: '0 16px 48px rgba(2,2,12,0.55)',
          color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#F43F5E', fontWeight: 700 }}>
            CampusXchange hit an error
          </div>
          <h1 style={{ fontSize: 20, margin: '10px 0 6px', fontFamily: '"Space Grotesk", sans-serif' }}>
            {String(error.message || error)}
          </h1>
          {info?.componentStack && (
            <pre style={{
              marginTop: 12, maxHeight: 180, overflow: 'auto', fontSize: 11,
              color: '#94A3B8', background: 'rgba(255,255,255,0.04)',
              padding: 12, borderRadius: 12, whiteSpace: 'pre-wrap',
            }}>{info.componentStack}</pre>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={() => window.location.reload()} style={btn('#3B82F6')}>Reload</button>
            <button
              onClick={() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} window.location.reload(); }}
              style={btn('#8B5CF6')}
            >
              Clear cached data &amp; reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function btn(color) {
  return {
    padding: '9px 16px', borderRadius: 12, border: `1px solid ${color}66`,
    background: `${color}22`, color: '#E2E8F0', cursor: 'pointer',
    fontSize: 13, fontWeight: 600,
  };
}
