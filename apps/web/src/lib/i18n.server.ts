/**
 * Helper SERVEUR (RSC uniquement) — préchargement des dictionnaires pour le SSR.
 * Fichier séparé volontairement : il tire `server/i18n` (fs + crypto) et ne doit JAMAIS
 * entrer dans le graphe client (`use client`), sinon webpack casse sur les schémas `node:`.
 */
import { loadNamespace, getFallbackLanguage } from '@/server/i18n/server';

type Dict = Record<string, string>;

/** Préchargement serveur → injecté dans le provider (valeurs initiales) ; fusion avec la langue de secours. */
export async function fetchNamespaceDicts(lang: string, namespaces: string[]): Promise<Record<string, Dict>> {
  const fb = getFallbackLanguage();
  const out: Record<string, Dict> = {};
  for (const ns of namespaces) {
    const main = loadNamespace(lang, ns).data;
    if (lang !== fb) {
      const fbData = loadNamespace(fb, ns).data;
      if (Object.keys(fbData).some((k) => main[k] === undefined)) out[ns] = { ...fbData, ...main };
      else out[ns] = main;
    } else out[ns] = main;
  }
  return out;
}
