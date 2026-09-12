import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../../store/ui.js';
import { useNavigate } from 'react-router-dom';

const toneStyles = {
  info: 'border-primary/40 shadow-glow',
  success: 'border-success/50',
  warning: 'border-warning/50',
  danger: 'border-danger/50',
};

/** Live toast host — Socket.io notifications surface here as glass toasts. */
export default function ToastHost() {
  const { toasts, removeToast } = useUI();
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[70] flex w-80 flex-col gap-3">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.95 }}
            className={`glass-strong pointer-events-auto cursor-pointer rounded-xl border px-4 py-3 ${toneStyles[t.variant] || toneStyles.info}`}
            onClick={() => {
              removeToast(t.id);
              if (t.link) navigate(t.link);
            }}
          >
            <div className="text-sm font-semibold text-ink">{t.title}</div>
            {t.message && <div className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{t.message}</div>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
