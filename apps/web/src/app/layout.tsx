/**
 * Layout racine — SSR : lit le cookie de langue (lang/dir initiaux), précharge les namespaces
 * communs, applique le thème actif (variables CSS injectées), préchargement des polices critiques.
 */
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import './fonts.css';
import { Providers } from '@/components/providers';
import { fetchNamespaceDicts } from '@/lib/i18n.server';
import { getLanguages, getFallbackLanguage } from '@/server/i18n/server';
import { activeThemeCss } from '@/server/themes';
import { getActiveProfile } from '@/server/country';
import { brandingState } from '@/server/branding';
// `lib/branding-shared` (et non `lib/branding`, marqué 'use client') : un composant serveur ne peut
// pas importer les VALEURS d'un module client — il n'en reçoit que des références de composant.
import { DEFAULT_BRANDING, type BrandingValue } from '@/lib/branding-shared';

export const dynamic = 'force-dynamic';

/**
 * Métadonnées dynamiques : le titre de l'onglet et l'icône suivent l'identité visuelle configurée
 * (Paramètres » Général). Un échec de lecture (base injoignable au démarrage) retombe sur les
 * valeurs par défaut plutôt que de casser toute l'application.
 */
async function readBranding(): Promise<BrandingValue> {
  try {
    const state = await brandingState();
    return {
      appName: state.appName || DEFAULT_BRANDING.appName,
      orgName: state.orgName,
      logoUrl: state.logo?.url ?? null,
      faviconUrl: state.favicon?.url ?? null,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const branding = await readBranding();
  return {
    title: { default: `${branding.appName} — DPI médical`, template: `%s · ${branding.appName}` },
    description: 'Dossier Patient Informatique — multi-langue, multi-thèmes, hébergeable 100 % en interne (loi 18-07).',
    manifest: '/manifest.webmanifest',
    icons: { icon: branding.faviconUrl ?? '/icon.svg' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1b24' },
  ],
};

const LANG_COOKIE = 'sardpi_lang';

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const jar = await cookies();
  const lang = jar.get(LANG_COOKIE)?.value ?? getFallbackLanguage();
  const manifest = getLanguages();
  const languages = manifest.languages;
  const entry = languages.find((l) => l.code === lang) ?? languages[0]!;
  const dicts = await fetchNamespaceDicts(entry.code, ['common', 'errors', 'auth']);
  const themeCss = await activeThemeCss().catch(() => null);
  const activeProfile = await getActiveProfile().catch(() => null);
  const profile = activeProfile?.profile ?? null;
  const serverPrefs = { density: null, nav: null, theme: null }; // affinées côté client via /auth/me
  const branding = await readBranding();

  return (
    <html lang={entry.code} dir={entry.dir} data-motion="on" className="motion-on">
      <head>
        {/* Préchargement des polices critiques (latin 400/600 + mono + arabe 400 si RTL) — §13.1, zéro CDN */}
        <link rel="preload" href="/fonts/ibm-plex-sans-latin-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ibm-plex-sans-latin-600.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ibm-plex-mono-latin-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        {entry.code === 'ar' ? <link rel="preload" href="/fonts/ibm-plex-sans-arabic-arabic-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /> : null}
        {/* Anti-flash : thème clair/sombre + motion + overrides AVANT la première peinture (localStorage). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var u=JSON.parse(localStorage.getItem('sardpi:ui')||'{}');var e=document.documentElement;var dm=u.themeMode==='dark'||(u.themeMode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);e.classList.toggle('dark',!!dm);e.dataset.motion=u.motion===false?'off':'on';e.classList.toggle('motion-on',u.motion!==false);if(u.density)e.dataset.density=u.density;if(u.nav)e.dataset.nav=u.nav;if(u.langOverride){e.lang=u.langOverride;e.dir=u.langOverride==='ar'?'rtl':'ltr';}}catch(_){}`,
          }}
        />
        {themeCss ? <style id="sardpi-theme" dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      </head>
      <body>
        <Providers
          initialLang={entry.code}
          initialDicts={dicts}
          languages={languages.map((l) => ({ code: l.code, label: l.name, dir: l.dir }))}
          profile={profile}
          serverPrefs={serverPrefs}
          branding={branding}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
