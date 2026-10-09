'use client';
/**
 * Shell applicatif : garde d'authentification + navigation (sidebar / topbar / rail — data-nav),
 * topbar (recherche globale, langue, thème, thème visuel, menu profil), fil d'Ariane avec bouton
 * retour mis en évidence, blobs de fond animés, bannière licence.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  CalendarRange,
  ChevronFirst,
  FlaskConical,
  FolderOpen,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageSquare,
  Moon,
  NotebookText,
  Palette,
  Pill,
  Search,
  Settings,
  Shield,
  Stethoscope,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { useT, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SessionLoader } from '@/components/loaders';
import { Breadcrumb } from '@/components/breadcrumb';
import { ProfileMenu } from '@/components/profile-menu';

interface NavItem {
  key: string;
  href: string;
  module: string | null;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}
const NAV_MAIN: NavItem[] = [
  { key: 'nav.dashboard', href: '/dashboard', module: null, icon: LayoutDashboard },
  { key: 'nav.patients', href: '/patients', module: 'patient', icon: Users },
  { key: 'nav.calendar', href: '/calendar', module: 'appointment', icon: CalendarRange },
  { key: 'nav.records', href: '/records/CON', module: 'record.consultation', icon: Stethoscope },
  { key: 'nav.lab', href: '/records/LAB', module: 'record.lab', icon: FlaskConical },
  { key: 'nav.pharmacy', href: '/pharmacy', module: 'record.pharmacy', icon: Pill },
  { key: 'nav.prescriptions', href: '/prescriptions', module: 'prescription', icon: NotebookText },
  { key: 'nav.ged', href: '/documents', module: 'ged', icon: FolderOpen },
  { key: 'nav.locations', href: '/locations', module: 'location', icon: MapPin },
  { key: 'nav.messages', href: '/messages', module: 'message', icon: MessageSquare },
];
const NAV_ADMIN: NavItem[] = [
  { key: 'nav.admin', href: '/admin', module: 'admin', icon: Shield },
  { key: 'nav.settings', href: '/admin/settings', module: 'admin', icon: Settings },
];

/** Revalidation de session d'un onglet ouvert : période, et délai minimal entre deux vérifications. */
const PROBE_INTERVAL_MS = 60_000;
const PROBE_MIN_MS = 20_000;

export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const status = useAuth((s) => s.status);
  const has = useAuth((s) => s.has);
  const license = useAuth((s) => s.license);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useT('common');
  const { t: tAuth } = useT('auth');
  const ui = useUi();
  const reduce = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState('');
  const topbarRef = React.useRef<HTMLElement | null>(null);

  /**
   * Garde d'authentification. Le Shell ne REND JAMAIS l'application sans session vérifiée
   * (`status !== 'authed'` → écran de vérification, voir plus bas). La redirection, elle, est
   * centralisée dans le store (`sessionLost`) : elle vide l'état, purge les données de santé en
   * mémoire (react-query) et construit l'URL de retour. Ici on ne fait que la déclencher si le
   * statut est passé à « anonymous » sans être passé par ce chemin (défense en profondeur).
   */
  useEffect(() => {
    if (status === 'anonymous') useAuth.getState().sessionLost('ended');
  }, [status]);

  /**
   * BATTEMENT DE CŒUR DE SESSION — un onglet laissé ouvert ne doit pas continuer d'afficher le
   * dossier patient alors que sa session a été coupée (déconnexion depuis un autre appareil,
   * révocation par l'administrateur, mot de passe réinitialisé, base réinitialisée, cookie disparu).
   * On revalide donc périodiquement ET au retour au premier plan / à la reconnexion réseau.
   *
   * Pourquoi `refreshNow` : c'est le seul appel qui prouve la validité réelle de la session (le
   * jeton d'accès en mémoire peut être encore signé alors que la session n'existe plus). En cas
   * d'échec définitif, le store vide l'état, purge le cache et renvoie vers /login — donc l'écran
   * se vide de lui-même sans action de l'utilisateur. Le throttle évite d'empiler des vérifications
   * quand l'utilisateur alterne rapidement entre fenêtres.
   */
  const verifySession = useAuth((s) => s.refreshNow);
  useEffect(() => {
    if (status !== 'authed') return;
    let last = Date.now();
    const verify = (): void => {
      if (document.hidden || Date.now() - last < PROBE_MIN_MS) return;
      last = Date.now();
      void verifySession();
    };
    const id = window.setInterval(verify, PROBE_INTERVAL_MS);
    document.addEventListener('visibilitychange', verify);
    window.addEventListener('focus', verify);
    window.addEventListener('online', verify);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', verify);
      window.removeEventListener('focus', verify);
      window.removeEventListener('online', verify);
    };
  }, [status, verifySession]);

  const items = useMemo(() => {
    const vis = NAV_MAIN.filter((n) => !n.module || has(n.module, 'view'));
    const adm = NAV_ADMIN.filter((n) => !n.module || has(n.module, 'view'));
    return { vis, adm };
  }, [has]);

  /**
   * Publie la hauteur RÉELLE de la chrome collante (bandeau licence + topbar + fil d'Ariane) dans
   * « --app-sticky-top » : la sous-navigation des Paramètres s'y colle sans marge codée en dur
   * (voir .sticky-under-topbar). Recalculé au redimensionnement, au zoom, au changement de
   * densité (data-density), de mode de navigation, et à l'apparition du bandeau licence.
   */
  useEffect(() => {
    const el = topbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const apply = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = Math.round(el.getBoundingClientRect().bottom) + 12;
        document.documentElement.style.setProperty('--app-sticky-top', `${Math.max(48, h)}px`);
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    ro.observe(document.body); // bandeau licence, polices, libellés longs
    window.addEventListener('resize', apply);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [license?.state, items.vis.length, items.adm.length, ui.density, ui.nav]);


  const LangSwitch: React.ReactElement = <LanguageSwitcher />;

  if (status !== 'authed') {
    // plein écran sobre pendant la vérification de session (login rend lui-même son propre écran)
    if (pathname === '/login' || pathname === '/' || pathname.startsWith('/verify/')) return <>{children}</>;
    // 'checking' = /auth/refresh en cours ; 'authenticating' = connexion en cours.
    // On n'expulse vers /login QUE sur 'anonymous' (voir useEffect) : sinon un utilisateur
    // muni d'un cookie de refresh valide était renvoyé à la connexion à chaque rechargement.
    return <SessionLoader label={status === 'authenticating' ? tAuth('login.submitting') : undefined} />;
  }

  const sidebar = (
    <nav className="flex h-full min-h-0 w-full flex-col gap-1 p-3" aria-label={t('nav.main')}>
      <Link href="/dashboard" className={cn('mb-2 flex items-center gap-2.5 rounded-xl px-2 py-2 font-bold', ui.sidebarCollapsed && 'lg:hidden')}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[rgb(var(--c-primary))] text-[16px] text-[rgb(var(--c-primary-ink))] shadow-[var(--shadow-glow)]">S</span>
        {!ui.sidebarCollapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] leading-tight">sarDPI</span>
            <span className="block text-[10.5px] font-medium uppercase tracking-wide text-[rgb(var(--c-muted))]">DPI · {license?.state === 'demo' ? t('app.demo') : t('app.name')}</span>
          </span>
        ) : null}
      </Link>
      {items.vis.map((n) => (
        <NavLink key={n.href} item={n} pathname={pathname} collapsed={ui.sidebarCollapsed} t={t} />
      ))}
      {items.adm.length ? (
        <>
          <div className={cn('mt-3 mb-1 text-[10.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]', ui.sidebarCollapsed ? 'text-center' : 'px-2')}>{t('nav.adminSection')}</div>
          {items.adm.map((n) => (
            <NavLink key={n.href} item={n} pathname={pathname} collapsed={ui.sidebarCollapsed} t={t} />
          ))}
        </>
      ) : null}
      <div className="mt-auto flex flex-col gap-1">
        <button
          className={cn('btn btn-ghost hidden lg:inline-flex', ui.sidebarCollapsed && 'btn-icon')}
          onClick={() => ui.set({ sidebarCollapsed: !ui.sidebarCollapsed })}
          title={t('nav.toggleSidebar')}
        >
          <ChevronFirst size={16} className={cn('transition-transform', ui.sidebarCollapsed && 'rotate-180', 'rtl:rotate-180 ltr:rotate-0', ui.sidebarCollapsed && 'ltr:rotate-180 rtl:rotate-0')} />
          {!ui.sidebarCollapsed ? t('nav.collapse') : null}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Blobs animés (désactivés si motion off / prefers-reduced-motion) */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <div className="bg-blob left-[-10%] top-[-15%] h-[45vw] w-[45vw] bg-[rgb(var(--c-primary)/0.32)]" />
        <div className="bg-blob blob-2 end-[-12%] top-[35%] h-[38vw] w-[38vw] bg-[rgb(var(--c-mint)/0.28)]" />
        <div className="bg-blob blob-3 bottom-[-18%] start-[20%] h-[42vw] w-[42vw] bg-[rgb(var(--c-info)/0.16)]" />
      </div>

      {license?.state === 'expired' || license?.state === 'invalid' ? (
        <div className="sticky top-0 z-40 bg-[rgb(var(--c-coral))] px-4 py-2 text-center text-[13px] font-semibold text-white">{t('license.expired')}</div>
      ) : null}
      {license?.state === 'demo' ? <div className="sticky top-0 z-40 bg-[rgb(var(--c-amber))] px-4 py-1.5 text-center text-[12px] font-semibold text-[#3d2a00]">{t('license.demo')}</div> : null}

      <div className="flex min-h-dvh">
        {/* Sidebar desktop (modes sidebar | rail) */}
        <aside
          className={cn(
            'glass-soft sticky top-0 hidden h-dvh shrink-0 flex-col border-e-0 lg:flex',
            ui.sidebarCollapsed ? 'w-[68px]' : 'w-[236px]',
            'transition-[width] duration-200 app-sidebar',
          )}
        >
          {sidebar}
        </aside>

        <div className="min-w-0 flex-1">
          {/* Topbar */}
          <header ref={topbarRef} className="glass-soft sticky top-0 z-30 rounded-none border-x-0 border-t-0 px-3 py-2">
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-sm btn-icon lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('nav.openMenu')}>
                <Menu size={18} />
              </button>
              <form
                className="relative min-w-0 flex-1 max-w-md"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (q.trim()) router.push(`/patients?q=${encodeURIComponent(q.trim())}`);
                }}
              >
                <Search size={15} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-2.5 rtl:right-2.5" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.global')} className="field ps-8 max-md:ps-8" style={{ paddingInlineStart: '2.1rem' }} />
              </form>
              <div className="ms-auto flex items-center gap-1.5">
                <button className="btn btn-ghost btn-sm btn-icon" title={t('ui.toggleDark')} onClick={() => ui.set({ themeMode: ui.themeMode === 'dark' ? 'light' : 'dark' })}>
                  {ui.themeMode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <Link className="btn btn-ghost btn-sm btn-icon" href="/admin/themes" title={t('ui.theme')}>
                  <Palette size={16} />
                </Link>
                {LangSwitch}
                <ProfileMenu />
              </div>
            </div>

            {/* Bouton retour mis en évidence + chemin complet (fil d'Ariane) — rien sur /dashboard. */}
            <Breadcrumb className="mt-1.5" />
          </header>

          {/* Nav horizontale (mode topbar) */}
          <div className="app-topnav glass-soft gap-1 overflow-x-auto px-2 py-1.5">
              {[...items.vis, ...items.adm].map((n) => (
                <Link key={n.href} href={n.href} className={cn('btn btn-sm', pathname.startsWith(n.href) && 'btn-primary')}>
                  <n.icon size={14} /> {t(n.key)}
                </Link>
              ))}
            </div>

          <main className="relative mx-auto w-full max-w-[1840px] px-2 py-3 md:px-3.5 md:py-4">{children}</main>
        </div>
      </div>

      {/* Tiroir mobile */}
      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-[rgb(9_40_56/0.45)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              className="glass-card absolute inset-y-0 start-0 w-[280px] rounded-none"
              initial={{ x: 'var(--from)' }}
              animate={{ x: 0 }}
              exit={{ x: 'var(--from)' }}
              transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              style={{ ['--from' as string]: document.documentElement.dir === 'rtl' ? '-100%' : '100%' } as React.CSSProperties}
            >
              <button className="btn btn-ghost btn-sm btn-icon absolute top-3 z-10 ltr:right-3 rtl:left-3" onClick={() => setMobileOpen(false)}>
                <X size={16} />
              </button>
              {sidebar}
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NavLink({ item, pathname, collapsed, t }: { item: NavItem; pathname: string | null; collapsed: boolean; t: (k: string) => string }): React.ReactElement {
  const active = pathname === item.href || (item.href !== '/dashboard' && (pathname ?? '').startsWith(item.href));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? t(item.key) : undefined}
      className={cn(
        'group relative flex min-h-[var(--row-h)] items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] font-semibold transition-colors',
        collapsed && 'lg:justify-center lg:px-0',
        active ? 'bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]' : 'text-[rgb(var(--c-ink)/0.75)] hover:bg-[rgb(var(--c-surface-2))]',
      )}
    >
      {active ? <motion.span layoutId="nav-active" className="absolute inset-y-1 w-[3px] rounded-full bg-[rgb(var(--c-primary))] ltr:left-0 rtl:right-0" transition={{ type: 'spring', stiffness: 500, damping: 40 }} /> : null}
      <Icon size={17} className="shrink-0" />
      {!collapsed ? <span className="truncate">{t(item.key)}</span> : null}
    </Link>
  );
}

/** Bascule de langue — rechargement des namespaces SANS rechargement de page. */
function LanguageSwitcher(): React.ReactElement {
  const { lang, languages, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn btn-ghost btn-sm gap-1" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="langue">
        {lang.toUpperCase()}
      </button>
      {open ? (
        <div className="glass-card absolute end-0 top-[40px] z-50 w-44 p-1.5">
          {languages.map((l) => (
            <button
              key={l.code}
              className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]', l.code === lang && 'bg-[rgb(var(--c-primary-soft))]')}
              onClick={() => {
                void setLang(l.code);
                setOpen(false);
              }}
            >
              <span>{l.label}</span>
              <span className="text-[10.5px] uppercase text-[rgb(var(--c-muted))]">{l.code}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

