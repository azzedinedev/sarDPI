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
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** classe du panneau (largeur, padding…) */
  className?: string;
  panelClassName?: string;
}): React.ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = (): void => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const m = menuRef.current?.getBoundingClientRect();
      const w = m?.width || 260;
      const h = m?.height || 240;
      let top = a.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
      let left = a.right - w; // alignement fin (logique « end »), cohérent RTL car basé sur des coordonnées physiques
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
      setPos({ top, left });
    };
    place();
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); window.removeEventListener('keydown', esc); };
  }, [open, onClose, anchor]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[190]" onClick={onClose} aria-hidden />
      <div ref={menuRef} className={cn('glass-card fixed z-[200] p-2 shadow-[var(--shadow-lift)]', className)} style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }} data-open={open}>
        {children}
      </div>
    </>,
    document.body,
  );
}
