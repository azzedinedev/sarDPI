// @vitest-environment happy-dom
/**
 * IDENTITÉ VISUELLE À L'ÉCRAN — logo téléversé vs monogramme généré.
 * ------------------------------------------------------------------
 * Le logo était codé en dur (« S » + « sarDPI » dans la barre latérale et sur l'écran de connexion) :
 * changer le nom de l'application dans Paramètres » Général ne changeait rien à l'écran. Il descend
 * désormais du rendu serveur (layout racine) par contexte, et un composant unique l'affiche.
 *
 * Ce qui est verrouillé ici :
 *   1. avec un logo : une image `<img src="/api/v1/branding/logo?v=…">` (la révision anti-cache est
 *      conservée telle quelle — sans elle, un changement de logo n'apparaîtrait pas avant des heures) ;
 *   2. sans logo : le MONOGRAMME repris du nom de l'application (pas une lettre « S » figée), et
 *      aucune image cassée ;
 *   3. le nom de l'application configuré remplace « sarDPI » partout où le logo est affiché ;
 *   4. la barre latérale du Shell utilise bien ce composant (intégration, pas seulement l'unité) ;
 *   5. hors contexte (composant monté seul) : repli sûr sur les valeurs par défaut, jamais de crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', async () => {
  const R = await import('react');
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _w, layout: _l, layoutId: _lid, variants: _v, custom: _c, ...rest } = props;
    return R.createElement(tag, rest, children as React.ReactNode);
  };
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children as React.ReactNode),
    MotionConfig: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children as React.ReactNode),
    useReducedMotion: () => true,
  };
});
const SEARCH_PARAMS = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => SEARCH_PARAMS,
  useParams: () => ({}),
}));
vi.mock('next/link', async () => {
  const R = await import('react');
  return { default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => R.createElement('a', { href, ...rest }, children as React.ReactNode) };
});
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({})), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), upload: vi.fn(), download: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dicts = Object.fromEntries(
  ['common', 'auth', 'settings', 'patient', 'errors'].map((ns) => [ns, JSON.parse(fs.readFileSync(path.join(ROOT, `locales/fr/${ns}.json`), 'utf8')) as Record<string, string>]),
);

const { I18nProvider } = await import('../apps/web/src/lib/i18n');
const { ToastProvider } = await import('../apps/web/src/components/toast');
const { BrandingProvider, DEFAULT_BRANDING } = await import('../apps/web/src/lib/branding');
type BrandingValue = import('../apps/web/src/lib/branding').BrandingValue;
const { AppLogo } = await import('../apps/web/src/components/app-logo');
const { useAuth } = await import('../apps/web/src/stores/auth');
const { Shell } = await import('../apps/web/src/components/layout/shell');

const LOGO = '/api/v1/branding/logo?v=f163728cac3a';

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  const tree = React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(I18nProvider, {
      initialLang: 'fr',
      initialDicts: dicts,
      languages: [{ code: 'fr', label: 'Français', dir: 'ltr' as const }],
      children: React.createElement(ToastProvider, null, node),
    }),
  );
  await act(async () => {
    root = createRoot(host!);
    root.render(tree);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 8));
  });
  return host;
}

function withBranding(value: BrandingValue | null, child: React.ReactElement): React.ReactElement {
  return React.createElement(BrandingProvider, { value }, child);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  useAuth.setState({
    perms: ['*'],
    status: 'authed',
    user: { id: 1, username: 'admin', fullName: 'Amina BENKHELFOUN', locale: 'fr' },
    license: null,
    has: () => true,
  } as never);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});

describe('AppLogo — logo téléversé', () => {
  it('affiche l’image avec sa révision anti-cache et le nom configuré', async () => {
    const el = await mount(
      withBranding({ appName: 'Cabinet Boumerdès', orgName: '', logoUrl: LOGO, faviconUrl: null }, React.createElement(AppLogo, { withText: true, subtitle: 'DPI' })),
    );
    const img = el.querySelector<HTMLImageElement>('img');
    expect(img, 'logo absent').toBeTruthy();
    expect(img!.getAttribute('src')).toBe(LOGO); // la révision ?v= n'est pas rognée
    expect(el.textContent).toContain('Cabinet Boumerdès');
    expect(el.textContent).toContain('DPI');
    // aucun monogramme en doublon quand une image est fournie
    expect(el.querySelectorAll('span[aria-hidden="true"]').length).toBe(0);
  });

  it('sans logo : monogramme repris du NOM CONFIGURÉ (plus de « S » codé en dur)', async () => {
    const el = await mount(withBranding({ ...DEFAULT_BRANDING, appName: 'Clinique Les Oliviers' }, React.createElement(AppLogo, { withText: true })));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('C'); // initiale du nom configuré
    expect(el.textContent).toContain('Clinique Les Oliviers');
  });

  it('hors contexte : repli sur les valeurs par défaut, sans crash ni image cassée', async () => {
    const el = await mount(React.createElement(AppLogo, { withText: true }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain(DEFAULT_BRANDING.appName);
    expect(el.textContent).toContain('S');
  });

  it('nom vide : le monogramme ne s’efface pas (toujours une initiale affichable)', async () => {
    const el = await mount(withBranding({ appName: '   ', orgName: '', logoUrl: null, faviconUrl: null }, React.createElement(AppLogo, {})));
    expect(el.textContent).toContain('S');
  });

  it('logo seul (sans texte) : l’image porte le nom en alternative textuelle', async () => {
    const el = await mount(withBranding({ appName: 'sarDPI', orgName: '', logoUrl: LOGO, faviconUrl: null }, React.createElement(AppLogo, {})));
    const img = el.querySelector<HTMLImageElement>('img')!;
    expect(img.getAttribute('alt')).toBe('sarDPI');
  });
});

describe('Barre latérale du Shell — intégration', () => {
  it('le logo téléversé remplace le monogramme dans la navigation', async () => {
    const el = await mount(withBranding({ appName: 'Cabinet Boumerdès', orgName: '', logoUrl: LOGO, faviconUrl: null }, React.createElement(Shell, null, React.createElement('main', null, 'contenu'))));
    const nav = el.querySelector('nav[aria-label]');
    expect(nav, 'navigation absente').toBeTruthy();
    const img = nav!.querySelector<HTMLImageElement>('img');
    expect(img, 'logo absent de la barre latérale').toBeTruthy();
    expect(img!.getAttribute('src')).toBe(LOGO);
    expect(nav!.textContent).toContain('Cabinet Boumerdès');
  });

  it('sans logo personnalisé : le monogramme et le nom par défaut restent affichés', async () => {
    const el = await mount(withBranding(null, React.createElement(Shell, null, React.createElement('main', null, 'contenu'))));
    const nav = el.querySelector('nav[aria-label]')!;
    expect(nav.querySelector('img')).toBeNull();
    expect(nav.textContent).toContain(DEFAULT_BRANDING.appName);
  });
});
