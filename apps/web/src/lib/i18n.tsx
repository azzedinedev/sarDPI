/**
 * i18n client — chargement à la demande des namespaces via GET /api/v1/i18n/{lang}/{ns}
 * avec cache localStorage + revalidation par ETag (304 = pas de parsing), bascule de langue
 * SANS rechargement de page (cookie + state), fallback déjà fusionné côté serveur
 * (aucune clé brute n'est jamais affichée).
 */
'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Dict = Record<string, string>;

interface I18nValue {
  lang: string;
  dir: 'rtl' | 'ltr';
  languages: { code: string; label: string; dir: 'rtl' | 'ltr' }[];
  dict: (ns: string) => Dict | undefined;
  t: (ns: string, key: string, vars?: Record<string, string | number>) => string;
  setLang: (lang: string) => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<I18nValue | null>(null);

const NS_CACHE = 'sardpi:i18n:v2';
const memCache = new Map<string, { etag?: string; data: Dict }>();

interface Snapshot {
  lang: string;
  namespaces: Record<string, Dict>;
}

export function readSnapshot(): Snapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(NS_CACHE) ?? 'null') as Snapshot | null;
  } catch {
    return null;
  }
}

function writeSnapshot(lang: string, dicts: Record<string, Dict>): void {
  try {
    localStorage.setItem(NS_CACHE, JSON.stringify({ lang, namespaces: dicts }));
  } catch {
    /* quota */
  }
}

function interpolate(tpl: string, vars?: Record<string, string | number>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k as string] ?? `{${k}}`));
}

/**
 * Langue active, lisible HORS composant (exports CSV, infobulles, fonctions utilitaires qui ne
 * peuvent pas appeler de hook). Maintenue à jour par I18nProvider ; les rendus de valeurs
 * structurées (components/value-view) s'y réfèrent lorsque l'appelant ne transmet pas la langue.
 */
let ACTIVE_LANG = 'fr';
export function activeLang(): string {
  return ACTIVE_LANG;
}

export function I18nProvider({
  initialLang,
  initialDicts,
  languages,
  children,
}: {
  initialLang: string;
  initialDicts: Record<string, Dict>;
  languages: I18nValue['languages'];
  children: React.ReactNode;
}): React.ReactElement {
  const [lang, setLangState] = useState(initialLang);
  const [dicts, setDicts] = useState<Record<string, Dict>>(initialDicts);
  const [ready, setReady] = useState(Object.keys(initialDicts).length > 0);
  const loadedNs = useMemo(() => new Set(Object.keys(initialDicts)), [initialDicts]);
  const missing = useRefSet();

  const loadNs = useCallback(
    async (ns: string, l: string) => {
      const key = `${l}/${ns}`;
      const cached = memCache.get(key);
      try {
        const headers: Record<string, string> = {};
        if (cached?.etag) headers['if-none-match'] = cached.etag;
        const res = await fetch(`/api/v1/i18n/${l}/${ns}`, { headers });
        if (res.status === 304 && cached) return cached.data;
        if (!res.ok) return cached?.data;
        const j = (await res.json()) as { data: Dict; etag?: string };
        memCache.set(key, { etag: j.etag, data: j.data });
        return j.data;
      } catch {
        return cached?.data;
      }
    },
    [],
  );

  // Charger les namespaces manquants pour la langue courante (ceux déjà initiaux sont skip).
  const ensure = useCallback(
    async (ns: string) => {
      if (loadedNs.has(ns) && dicts[ns] !== undefined) return;
      const data = await loadNs(ns, lang);
      if (data) {
        setDicts((d) => {
          const next = { ...d, [ns]: data };
          writeSnapshot(lang, next);
          return next;
        });
        loadedNs.add(ns);
      }
    },
    [lang, loadNs, dicts, loadedNs],
  );

  // Miroir de la langue courante pour les appels hors composant (voir activeLang()).
  useEffect(() => {
    ACTIVE_LANG = lang;
  }, [lang]);

  useEffect(() => {
    void ensure('common');
    setReady(true);
  }, [ensure]);

  const t = useCallback(
    (ns: string, key: string, vars?: Record<string, string | number>) => {
      const dict = dicts[ns];
      if (dict === undefined) {
        // Espace de noms pas encore chargé (lazy-load à la première utilisation) : ce n'est PAS
        // une clé manquante. Le signaler noyait la console de dizaines de faux positifs à
        // l'ouverture d'une page — et masquait les vraies absences dans le rapport d'admin.
        // On rend la clé brute le temps du chargement, puis le re-render affichera la traduction.
        void ensure(ns);
        return key;
      }
      const v = dict[key];
      if (v === undefined) {
        // Cas réel : l'espace de noms est chargé et la clé n'y figure pas.
        missing.add(`${lang}/${ns}/${key}`);
        void ensure(ns); // la clé a pu être ajoutée depuis le chargement (i18n à chaud)
        return key;
      }
      return interpolate(v, vars);
    },
    [dicts, lang, ensure, missing],
  );

  const setLang = useCallback(
    async (next: string) => {
      const entry = languages.find((l) => l.code === next);
      document.cookie = `sardpi_lang=${next}; path=/; max-age=31536000; samesite=lax`;
      setLangState(next);
      if (entry) {
        document.documentElement.lang = next;
        document.documentElement.dir = entry.dir;
      }
      const loaded = new Map<string, Dict>();
      await Promise.all(
        [...loadedNs.keys()].map(async (ns) => {
          const data = await loadNs(ns, next);
          if (data) loaded.set(ns, data);
        }),
      );
      setDicts((d) => {
        const nextDicts = { ...d, ...Object.fromEntries(loaded) };
        writeSnapshot(next, nextDicts);
        return nextDicts;
      });
    },
    [languages, loadNs, loadedNs],
  );

  const dir = languages.find((l) => l.code === lang)?.dir ?? 'ltr';
  const value = useMemo<I18nValue>(() => ({ lang, dir, languages, dict: (ns) => dicts[ns], t, setLang, ready }), [lang, dir, languages, dicts, t, setLang, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook : contexte complet (langue, liste, changement à chaud). */
export function useI18n(): I18nValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('I18nProvider manquant');
  return ctx;
}

/** Hook : namespace de traduction (lazy-load à la première utilisation). */
export function useT(ns: string): { t: (key: string, vars?: Record<string, string | number>) => string; dict: Dict; lang: string; dir: 'rtl' | 'ltr' } {
  const ctx = useContext(Ctx);
  const [, force] = useState(0);
  useEffect(() => {
    // S'assurer que le ns est chargé ; re-render quand la dict apparaît.
    const current = ctx?.dict(ns);
    if (!current) {
      const ev = () => force((x) => x + 1);
      window.addEventListener('i18n:updated', ev);
      return () => window.removeEventListener('i18n:updated', ev);
    }
  }, [ctx, ns]);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => (ctx ? ctx.t(ns, key, vars) : key), [ctx, ns]);
  return { t, dict: ctx?.dict(ns) ?? {}, lang: ctx?.lang ?? 'fr', dir: ctx?.dir ?? 'ltr' };
}

/** Petit utilitaire : collection des clés manquantes (signalée en console dev uniquement). */
function useRefSet(): { add: (k: string) => void } {
  const ref = React.useRef(new Set<string>());
  return {
    add(k) {
      if (process.env.NODE_ENV === 'development' && !ref.current.has(k)) {
        ref.current.add(k);
        // eslint-disable-next-line no-console
        console.warn(`[i18n] clé manquante : ${k}`);
      }
    },
  };
}

