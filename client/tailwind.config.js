/**
 * CampusXchange design system — Tailwind layer.
 *
 * Single source of truth for the palette lives in TWO places that mirror each other:
 *   1. client/src/index.css  → CSS variables (rgb triplets, runtime-tweakable)
 *   2. client/src/theme/theme.js → JS tokens (for canvas/SVG work like the force graph)
 *
 * Colors are mapped from rgb-triplet variables with <alpha-value> so utilities like
 * bg-primary/20 work everywhere. Tweak the palette once in index.css/theme.js.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Deep space navy background scale (#0B0B1E → #14142B → #1E1E3D)
        space: {
          900: 'rgb(var(--bg-1-rgb) / <alpha-value>)',
          800: 'rgb(var(--bg-2-rgb) / <alpha-value>)',
          700: 'rgb(var(--bg-3-rgb) / <alpha-value>)',
        },
        // Electric blue core (#3B82F6 / #60A5FA)
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          light: 'rgb(var(--primary-light-rgb) / <alpha-value>)',
        },
        // Violet/Purple core (#8B5CF6 / #A855F7)
        accent: {
          DEFAULT: 'rgb(var(--violet-rgb) / <alpha-value>)',
          light: 'rgb(var(--violet-light-rgb) / <alpha-value>)',
        },
        // Small highlight accents
        success: 'rgb(var(--cyan-rgb) / <alpha-value>)',   // cyan — available/success
        warning: 'rgb(var(--amber-rgb) / <alpha-value>)',  // amber — warnings/overdue
        danger: 'rgb(var(--rose-rgb) / <alpha-value>)',    // rose — reports/alerts
        ink: {
          DEFAULT: 'rgb(var(--text-rgb) / <alpha-value>)',
          muted: 'rgb(var(--muted-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 8px 32px rgba(2, 2, 12, 0.45)',
        'glass-lg': '0 16px 48px rgba(2, 2, 12, 0.55)',
        glow: '0 0 24px rgba(59, 130, 246, 0.35)',
        'glow-violet': '0 0 24px rgba(139, 92, 246, 0.35)',
        'glow-sm': '0 0 12px rgba(96, 165, 250, 0.35)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-500px 0' }, '100%': { backgroundPosition: '500px 0' } },
        'float-slow': { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-14px)' } },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(96, 165, 250, 0.25)' },
          '50%': { boxShadow: '0 0 28px rgba(168, 85, 247, 0.45)' },
        },
        aurora: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        'float-slow': 'float-slow 7s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        aurora: 'aurora 6s ease infinite',
      },
      backgroundImage: {
        aurora: 'linear-gradient(120deg, #3B82F6, #8B5CF6, #D946EF, #3B82F6)',
      },
    },
  },
  plugins: [],
};
