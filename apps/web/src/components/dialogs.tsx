'use client';
/** Dialog (modal centrée) + Drawer (panneau latéral logique — côté droit en LTR, gauche en RTL) avec framer-motion et respect de data-motion. */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function useEscOpen(onClose: () => void, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  xwide,
  footer,
  closeOnClickOutside = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
  footer?: React.ReactNode;
  closeOnClickOutside?: boolean;
}): React.ReactElement | null {
  useEscOpen(onClose, open);
  const reduce = useReducedMotion();
  // portail sur <body> : un parent avec transform (framer-motion) ou overflow (carte de liste)
  // ne doit jamais enfermer/rogner la modale (fiches d'étape, confirmations…).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div className="fixed inset-0 z-[210] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.15 }}>
          <div
            className="absolute inset-0 bg-[rgb(9_40_56/0.45)] backdrop-blur-[3px]"
            onClick={closeOnClickOutside ? onClose : undefined}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cn('glass-card relative z-10 max-h-[min(88vh,900px)] w-full overflow-y-auto p-5 shadow-[var(--shadow-lift)]', xwide ? 'max-w-6xl' : wide ? 'max-w-4xl' : 'max-w-lg')}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-[17px] font-bold">{title}</h2>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="✕">
                <X size={16} />
              </button>
            </div>
            {children}
            {footer ? <div className="mt-4 flex justify-end gap-2 border-t border-[rgb(var(--c-line)/0.6)] pt-3">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
  closeOnClickOutside = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  closeOnClickOutside?: boolean;
}): React.ReactElement | null {
  useEscOpen(onClose, open);
  const reduce = useReducedMotion();
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[210]">
          <motion.div
            className="absolute inset-0 bg-[rgb(9_40_56/0.4)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnClickOutside ? onClose : undefined}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            className={cn('glass-card absolute inset-y-0 end-0 z-10 flex w-full flex-col rounded-none border-y-0 border-e-0 shadow-[var(--shadow-lift)]', width)}
            initial={{ x: 'var(--drawer-from, 100%)' }}
            animate={{ x: 0 }}
            exit={{ x: 'var(--drawer-from, 100%)' }}
            transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ ['--drawer-from' as string]: document.documentElement.dir === 'rtl' ? '-100%' : '100%' }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--c-line)/0.7)] p-4">
              <div className="min-w-0">
                <h2 className="truncate text-[16px] font-bold">{title}</h2>
                {subtitle ? <div className="mt-0.5 text-[12.5px] text-[rgb(var(--c-muted))]">{subtitle}</div> : null}
              </div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="✕">
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer ? <footer className="flex justify-end gap-2 border-t border-[rgb(var(--c-line)/0.7)] p-3">{footer}</footer> : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
