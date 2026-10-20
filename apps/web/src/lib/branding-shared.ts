/**
 * IDENTITÉ VISUELLE — types et helpers SANS dépendance React ni Node.
 * ------------------------------------------------------------------
 * Ce module est volontairement « neutre » (ni 'use client' ni imports serveur) : il est lu à la fois
 * par le layout racine (rendu serveur, qui descend les valeurs dans le contexte) et par les
 * composants clients. Mettre ces constantes dans `lib/branding.tsx` ('use client') casserait
 * l'import côté serveur — un module client n'exporte que des références de composant.
 */

export interface BrandingValue {
  /** nom de l'application (réglage « general.appName ») — jamais vide à l'écran */
  appName: string;
  orgName: string;
  /** URL publique de l'image (`/api/v1/branding/logo?v=…`) ou null si aucun logo personnalisé */
  logoUrl: string | null;
  faviconUrl: string | null;
}

export const DEFAULT_BRANDING: BrandingValue = { appName: 'sarDPI', orgName: '', logoUrl: null, faviconUrl: null };

export type BrandingKind = 'logo' | 'favicon';
export const BRANDING_KINDS: BrandingKind[] = ['logo', 'favicon'];

/** Types acceptés à la sélection de fichier (le serveur revérifie par magic bytes). */
export const BRANDING_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/** Tailles maximales — identiques à celles du serveur (`server/branding.ts`). */
export const BRANDING_MAX_BYTES: Record<BrandingKind, number> = { logo: 1024 * 1024, favicon: 256 * 1024 };

export type BrandingFileIssue = 'empty' | 'tooLarge' | 'badType' | null;

/** Contrôle immédiat côté navigateur (refus net avant l'envoi) ; le serveur reste l'autorité. */
export function checkBrandingFile(kind: BrandingKind, file: File): BrandingFileIssue {
  const max = BRANDING_MAX_BYTES[kind];
  if (!file || file.size <= 0) return 'empty';
  if (file.size > max) return 'tooLarge';
  const okType = /^image\/(png|jpeg|webp|gif|svg\+xml)$/i.test(file.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
  return okType ? null : 'badType';
}

/**
 * Applique l'icône d'onglet au document courant (après téléversement dans Paramètres » Général) :
 * le changement est visible sans rechargement. Les liens existants sont remplacés, pas empilés —
 * deux icônes simultanées laissent le navigateur en choisir une au hasard.
 */
export function applyFavicon(url: string | null): void {
  if (typeof document === 'undefined') return;
  const href = url ?? '/icon.svg';
  const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'));
  if (existing.length) {
    existing.forEach((el, i) => {
      if (i === 0) el.href = href;
      else el.remove();
    });
    return;
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = href;
  document.head.appendChild(link);
}
