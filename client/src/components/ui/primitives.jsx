import { motion } from 'framer-motion';

/** Glass primitives — the core of the futuristic glassmorphism kit. */

export function GlassCard({ className = '', hover = true, strong = false, children, ...props }) {
  return (
    <div
      className={`${strong ? 'glass-strong' : 'glass'} ${hover ? 'glass-hover' : ''} rounded-2xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({ tone = 'primary', className = '', children }) {
  const tones = {
    primary: 'bg-primary/15 text-primary-light border-primary/30',
    accent: 'bg-accent/15 text-accent-light border-accent/30',
    success: 'bg-success/15 text-success border-success/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    muted: 'bg-white/5 text-ink-muted border-white/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${tones[tone] || tones.primary} ${className}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}

export function CardSkeletonGrid({ count = 8 }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <GlassCard key={i} hover={false} className="p-4">
          <Skeleton className="mb-3 h-36 w-full rounded-xl" />
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </GlassCard>
      ))}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <div className={`animate-spin rounded-full border-2 border-white/20 border-t-primary-light ${className}`} />
  );
}

export function EmptyState({ icon = '◎', title, message, action = null }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
      <div className="mb-3 text-4xl opacity-40">{icon}</div>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right = null }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
