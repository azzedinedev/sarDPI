'use client';
/**
 * APPLICATION DU THÈME ACTIF SANS RECHARGEMENT.
 * ---------------------------------------------
 * Le thème visuel (dossier `/themes/<nom>/`) est injecté côté serveur dans `<style id="sardpi-theme">`
 * (variables CSS par mode + `styles.css` du thème). Quand l'administrateur change de thème — depuis
 * Paramètres » Interface & thèmes ou Administration » Thèmes — l'écran doit refléter le choix
 * IMMÉDIATEment : on relit `/admin/themes/active-css` (route publique, ETag) et on remplace le
 * contenu de la balise. Un seul helper partagé : les deux écrans ne peuvent pas diverger.
 */
import { api } from './api';

export interface ActiveThemeCss {
  name: string;
  css: string;
  etag?: string;
}

/** Relit et réinjecte le CSS du thème actif ; retourne le nom du thème appliqué (null si indisponible). */
export async function applyActiveThemeCss(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  try {
    const res = await api.get<ActiveThemeCss>('/admin/themes/active-css');
    if (!res || typeof res.css !== 'string') return null;
    const el = document.getElementById('sardpi-theme') ?? document.createElement('style');
    el.id = 'sardpi-theme';
    el.textContent = res.css;
    if (!el.parentNode) document.head.appendChild(el);
    return res.name ?? null;
  } catch {
    // thème illisible (base injoignable, route désactivée) : l'application garde le thème en place
    return null;
  }
}
