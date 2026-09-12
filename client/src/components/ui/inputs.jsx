import { motion } from 'framer-motion';

/** Form controls + CTA buttons of the glassmorphism kit. */

export function GradientButton({ children, className = '', variant = 'aurora', size = 'md', ...props }) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-sm', lg: 'px-7 py-3 text-base' };
  const variants = {
    aurora: 'bg-aurora aurora-anim text-white shadow-glow hover:shadow-glow-violet',
    outline:
      'aurora-border text-ink hover:border-accent/60 hover:shadow-glow-sm',
    ghost: 'text-ink-muted hover:text-ink hover:bg-white/5',
  };
  return (
    <motion.button
      whileHover={{ scale: props.disabled ? 1 : 1.03 }}
      whileTap={{ scale: props.disabled ? 1 : 0.97 }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-display font-semibold tracking-wide transition-shadow disabled:cursor-not-allowed disabled:opacity-40 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}

const fieldCls =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted/60 outline-none backdrop-blur transition focus:border-primary/60 focus:shadow-glow-sm';

export function Input({ label, hint, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</span>}
      <input className={fieldCls} {...props} />
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Select({ label, options = [], className = '', children, ...props }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</span>}
      <select className={`${fieldCls} [&>option]:bg-space-800`} {...props}>
        {children ??
          options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
      </select>
    </label>
  );
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</span>}
      <textarea className={`${fieldCls} min-h-[96px] resize-y`} {...props} />
    </label>
  );
}

export function StarRating({ value = 0, onChange = null, size = 18 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`transition ${onChange ? 'hover:scale-125 cursor-pointer' : 'cursor-default'}`}
          aria-label={`${n} star`}
        >
          <svg width={size} height={size} viewBox="0 0 24 24" fill={n <= value ? '#F59E0B' : 'rgba(255,255,255,0.18)'}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`glass-strong relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl p-6`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-white/10 hover:text-ink">✕</button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
