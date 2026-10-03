'use client';
/**
 * Menu du bouton profil.
 * -----------------------
 * Regroupe : identité (nom, rôle traduit, adresse, état de la licence), accès au profil et aux
 * paramètres, préférences d'affichage appliquées SANS rechargement (thème, animations, densité,
 * langue) et la déconnexion.
 * Accessibilité : role="menu" / "menuitem", navigation ↑ ↓ Home End, Échap pour fermer, fermeture
 * au clic extérieur et retour du focus sur le déclencheur — le menu précédent n'était ni navigable
 * au clavier ni annoncé correctement par les lecteurs d'écran.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ChevronDown,
  Contrast,
  Gauge,
  KeyRound,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
  Wind,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useI18n, useT } from '@/lib/i18n';
import { pickLabel } from '@sardpi/shared';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui';

/** Initiales affichées en l'absence de photo (1 à 2 lettres, casse forcée). */
function initials(fullName: string | null | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string).slice(0, 1)}${(parts[parts.length - 1] as string).slice(0, 1)}`.toUpperCase();
}

export function ProfileMenu(): React.ReactElement {
  const { t } = useT('common');
  const { t: tAuth } = useT('auth');
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.role);
  const license = useAuth((s) => s.license);
  const has = useAuth((s) => s.has);
  const logout = useAuth((s) => s.logout);
  const ui = useUi();
  const { lang, languages, setLang, dir } = useI18n();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Clic extérieur → fermeture.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Éléments actionnables du panneau, dans l'ordre visuel (navigation clavier). */
  const items = useCallback((): HTMLElement[] => {
    if (!wrapRef.current) return [];
    return Array.from(wrapRef.current.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'));
  }, []);

  // Échap ferme et rend le focus ; ↑ ↓ Home End déplacent le focus dans le menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.length === 0) return;
        const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
        list[next]?.focus();
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
      }
      // Tabulation : on garde le focus dans le menu (comportement attendu d'un menu ARIA).
      if (e.key === 'Tab' && list.length > 0) {
        e.preventDefault();
        const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
        list[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    // Focus initial sur le premier élément : le menu est immédiatement utilisable au clavier.
    const id = window.setTimeout(() => items()[0]?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
    };
  }, [open, items]);

  const roleLabel = role ? pickLabel(role.name ?? {}, lang, 'fr') || role.key : '';
  const canSettings = has('setting', 'view') || has('admin', 'view');

  const nextTheme = (m: 'light' | 'dark' | 'system'): 'light' | 'dark' | 'system' => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light');
  const ThemeIcon = ui.themeMode === 'dark' ? Moon : ui.themeMode === 'system' ? Monitor : Sun;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-sm gap-2"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={user?.fullName ?? ''}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[rgb(var(--c-primary))] text-[11px] font-bold text-[rgb(var(--c-primary-ink))]">
          {initials(user?.fullName)}
        </span>
        <span className="hidden max-w-[9rem] truncate md:inline">{user?.fullName}</span>
        <ChevronDown size={14} className={cn('shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            role="menu"
            aria-label={t('menu.profile')}
            initial={{ opacity: 0, y: reduce ? 0 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="glass-card absolute end-0 top-[46px] z-50 w-[19rem] max-w-[calc(100vw-1.5rem)] origin-top-end p-2 shadow-[var(--shadow-lift)]"
          >
            {/* ---------------- identité ---------------- */}
            <div className="flex items-start gap-2.5 rounded-xl bg-[rgb(var(--c-surface-2)/0.7)] p-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgb(var(--c-primary))] text-[15px] font-bold text-[rgb(var(--c-primary-ink))] shadow-[var(--shadow-glow)]">
                {initials(user?.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold text-[rgb(var(--c-ink))]">{user?.fullName || '—'}</p>
                <p className="truncate text-[11.5px] font-semibold text-[rgb(var(--c-primary))]">{roleLabel}</p>
                <p className="truncate text-[11px] text-[rgb(var(--c-muted))]">{user?.email || user?.username || '—'}</p>
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
              {license?.state === 'demo' ? <Badge tone="warn">{t('app.demo')}</Badge> : null}
              {user?.totpEnabled ? (
                <Badge tone="ok">
                  <ShieldCheck size={11} /> {t('menu.totpOn')}
                </Badge>
              ) : (
                <Badge tone="neutral">
                  <KeyRound size={11} /> {t('menu.totpOff')}
                </Badge>
              )}
            </div>

            {/* ---------------- navigation ---------------- */}
            <div className="my-1.5 border-t border-[rgb(var(--c-line)/0.6)]" />
            <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className={menuItemCls}>
              <User size={15} /> {t('menu.myProfile')}
            </Link>
            {canSettings ? (
              <Link role="menuitem" href="/admin/settings" onClick={() => setOpen(false)} className={menuItemCls}>
                <Settings size={15} /> {t('nav.settings')}
              </Link>
            ) : null}

            {/* ---------------- préférences d'affichage ---------------- */}
            <div className="my-1.5 border-t border-[rgb(var(--c-line)/0.6)]" />
            <p className="px-2.5 pb-1 pt-0.5 text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{t('menu.appearance')}</p>

            <button
              type="button"
              role="menuitem"
              className={menuItemCls}
              onClick={() => ui.set({ themeMode: nextTheme(ui.themeMode) })}
              title={t('menu.themeHint')}
            >
              <ThemeIcon size={15} />
              <span className="flex-1 truncate text-start">{t('menu.theme')}</span>
              <span className="shrink-0 text-[11px] font-bold uppercase text-[rgb(var(--c-muted))]">
                {ui.themeMode === 'dark' ? t('ui.dark') : ui.themeMode === 'system' ? t('ui.system') : t('ui.light')}
              </span>
            </button>

            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={ui.motion}
              className={menuItemCls}
              onClick={() => ui.set({ motion: !ui.motion })}
            >
              <Wind size={15} />
              <span className="flex-1 truncate text-start">{t('menu.motion')}</span>
              <span className={cn('shrink-0 text-[11px] font-bold', ui.motion ? 'text-[rgb(var(--c-ok))]' : 'text-[rgb(var(--c-muted))]')}>
                {ui.motion ? t('ui.on') : t('ui.off')}
              </span>
            </button>

            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={ui.density === 'compact'}
              className={menuItemCls}
              onClick={() => ui.set({ density: ui.density === 'compact' ? 'comfortable' : 'compact' })}
            >
              <Gauge size={15} />
              <span className="flex-1 truncate text-start">{t('menu.density')}</span>
              <span className="shrink-0 text-[11px] font-bold text-[rgb(var(--c-muted))]">
                {ui.density === 'compact' ? t('ui.compact') : t('ui.comfortable')}
              </span>
            </button>

            {/* Langue : bascule immédiate, sans rechargement de page. */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <Languages size={15} className="shrink-0 text-[rgb(var(--c-muted))]" />
              <span className="shrink-0 text-[12.5px] font-semibold">{t('lang.code')}</span>
              <span className="flex flex-1 flex-wrap justify-end gap-1">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={l.code === lang}
                    onClick={() => void setLang(l.code)}
                    title={l.label}
                    className={cn(
                      'rounded-lg border px-1.5 py-0.5 text-[11px] font-bold uppercase transition-colors',
                      l.code === lang
                        ? 'border-[rgb(var(--c-primary)/0.5)] bg-[rgb(var(--c-primary-soft))] text-[rgb(var(--c-primary))]'
                        : 'border-[rgb(var(--c-line))] text-[rgb(var(--c-muted))] hover:border-[rgb(var(--c-primary)/0.35)] hover:text-[rgb(var(--c-primary))]',
                    )}
                  >
                    {l.code}
                  </button>
                ))}
              </span>
            </div>

            <div className="my-1.5 border-t border-[rgb(var(--c-line)/0.6)]" />
            <button type="button" role="menuitem" className={cn(menuItemCls, 'text-[rgb(var(--c-coral))] hover:bg-[rgb(var(--c-coral-soft))]')} onClick={() => void logout()}>
              <LogOut size={15} className={dir === 'rtl' ? 'rotate-180' : undefined} /> {tAuth('logout')}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Classe partagée des entrées du menu (lien ou bouton) — même apparence, même comportement. */
const menuItemCls =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[12.5px] font-semibold text-[rgb(var(--c-ink))] outline-none transition-colors hover:bg-[rgb(var(--c-primary-soft)/0.7)] focus-visible:bg-[rgb(var(--c-primary-soft)/0.7)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--c-primary)/0.5)]';
