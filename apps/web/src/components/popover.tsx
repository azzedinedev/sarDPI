'use client';
/**
 * Menu ancré en PORTAIL, positionné en `fixed` d'après le rectangle de l'ancre :
 * jamais rogné par l'`overflow` des cartes/tableaux ni masqué par leurs contextes
 * d'empilement (backdrop-filter des surfaces glass). Bascule au-dessus si le bas
 * du viewport manque ; suit le scroll/resize ; se ferme au clic extérieur ou Échap.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface PopState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export function usePop(): PopState {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}

export function PopMenu({
  open,
  onClose,
  anchor,
  children,
  className,
  panelClassName,
  matchWidth,
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** classe du panneau (largeur, padding…) */
  className?: string;
  panelClassName?: string;
  /** panneau à la largeur exacte de l'ancre (combobox) */
  matchWidth?: boolean;
}): React.ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; w: number; minW: number; maxW: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = (): void => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const m = menuRef.current?.getBoundingClientRect();
      const minW = matchWidth ? Math.max(a.width, 280) : 260;
      const maxW = Math.min(window.innerWidth - 16, 560);
      const measuredW = m ? Math.max(m.width || 0, menuRef.current?.scrollWidth || 0, menuRef.current?.offsetWidth || 0) : minW;
      const w = Math.min(maxW, Math.max(minW, measuredW));
      const h = m?.height || 240;
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 4);
      const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
      let left = isRtl ? a.right - w : a.left;
      left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8));
      setPos({ top, left, w, minW, maxW });
    };
    place();
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); window.removeEventListener('keydown', esc); };
  }, [open, onClose, anchor, matchWidth]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[290]" onClick={onClose} aria-hidden />
      <div
        ref={menuRef}
        className={cn('glass-card !bg-[rgb(var(--c-surface))] border border-[rgb(var(--c-line))] fixed z-[300] p-1.5 shadow-2xl rounded-xl', className)}
        style={pos ? { top: pos.top, left: pos.left, width: pos.w, minWidth: pos.minW, maxWidth: pos.maxW } : { top: -9999, left: -9999, visibility: 'hidden', width: 'max-content', minWidth: 280, maxWidth: 560 }}
        data-open={open}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
