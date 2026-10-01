'use client';
/**
 * Providers client : Query (staleTime court, pas de cache persistant — données de santé),
 * auth (init via refresh cookie), i18n (loader lazy), profil pays (formatage Intl), toasts.
 */
import React, { useEffect, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';
import { setCountryProfile } from '@/lib/format';
import type { CountryProfile } from '@sardpi/shared';
import { ToastProvider } from '@/components/toast';
import { I18nProvider } from '@/lib/i18n';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Données médicales : jamais de cache persistant navigateur au-delà de la session ; revalidation on focus.
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: (count, err) => {
          const status = (err as { status?: number }).status;
          if (status && status >= 400 && status < 500) return false;
          return count < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({
  children,
  initialLang,
  initialDicts,
  languages,
  profile,
  serverPrefs,
}: {
  children: React.ReactNode;
  initialLang: string;
  initialDicts: Record<string, Record<string, string>>;
  languages: { code: string; label: string; dir: 'rtl' | 'ltr' }[];
  profile: CountryProfile | null;
  serverPrefs: { density: string | null; nav: string | null; theme: string | null };
}): React.ReactElement {
  const [client] = useMemo(() => [makeQueryClient()], []);
  const init = useAuth((s) => s.init);
  const setU = useUi((s) => s.set);

  useEffect(() => {
    setCountryProfile(profile);
    void init();
    // Préférences serveur (densité/nav) appliquées si l'utilisateur n'a pas d'override local.
    const ui = useUi.getState();
    if (ui.density === null && serverPrefs.density) document.documentElement.dataset.density = serverPrefs.density;
    if (ui.nav === null && serverPrefs.nav) document.documentElement.dataset.nav = serverPrefs.nav;
    void setU;
  }, [init, profile, serverPrefs.density, serverPrefs.nav, setU]);

  return (
    <QueryClientProvider client={client}>
      <I18nProvider initialLang={initialLang} initialDicts={initialDicts} languages={languages}>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
