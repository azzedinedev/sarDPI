'use client';
/** Toasts (erreurs, succès, sync external, etc.). */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
interface ToastApi {
  push: (kind: ToastKind, text: string) => void;
  success: (t: string) => void;
  error: (t: string) => void;
  info: (t: string) => void;
  warning: (t: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq;
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);
  const api = useMemo<ToastApi>(() => ({ push, success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t), warning: (t) => push('warning', t) }), [push]);
  const reduce = useReducedMotion();
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 z-[400] flex w-[min(92vw,380px)] flex-col gap-2 ltr:right-4 rtl:left-4" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cnT(t.kind)}
            >
              {t.kind === 'success' ? <CheckCircle2 size={16} className="shrink-0 text-[rgb(var(--c-ok))]" /> : t.kind === 'error' ? <AlertTriangle size={16} className="shrink-0 text-[rgb(var(--c-coral))]" /> : t.kind === 'warning' ? <AlertTriangle size={16} className="shrink-0 text-[rgb(var(--c-amber))]" /> : <Info size={16} className="shrink-0 text-[rgb(var(--c-info))]" />}
              <span className="min-w-0 flex-1 text-[13px] font-medium">{t.text}</span>
              <button className="pointer-events-auto opacity-60 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="✕">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

function cnT(kind: ToastKind): string {
  const base = 'glass-card pointer-events-auto flex items-start gap-2.5 p-3 text-sm shadow-[var(--shadow-lift)]';
  return kind === 'error' ? `${base} border-[rgb(var(--c-coral)/0.45)]` : kind === 'success' ? `${base} border-[rgb(var(--c-ok)/0.4)]` : kind === 'warning' ? `${base} border-[rgb(var(--c-amber)/0.45)]` : base;
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('ToastProvider manquant');
  return v;
}
