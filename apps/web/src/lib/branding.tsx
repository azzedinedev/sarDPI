'use client';
/**
 * CONTEXTE « IDENTITÉ VISUELLE » (client) — nom de l'application, logo, icône d'onglet.
 * -----------------------------------------------------------------------------------
 * Les valeurs sont lues côté SERVEUR par le layout racine (réglage « general » + fichiers de
 * `storage/branding/`) puis descendues dans ce contexte : aucun appel réseau au démarrage et aucun
 * flash d'un logo par défaut avant hydratation. Un logo absent vaut `null` — les écrans retombent
 * alors sur le monogramme généré (première lettre du nom), jamais sur une image cassée.
 *
 * Après un téléversement (Paramètres » Général » Identité visuelle), l'écran invalide la requête
 * `['branding']` et applique l'icône au document ; le logo, lui, apparaît au prochain rendu serveur
 * (rechargement) — l'aperçu est donc immédiat dans le formulaire, l'application entière suit.
 *
 * Les types et helpers neutres vivent dans `lib/branding-shared.ts` (importables côté serveur).
 */
import React, { createContext, useContext, useMemo } from 'react';
import { DEFAULT_BRANDING, type BrandingValue } from './branding-shared';

export * from './branding-shared';

const BrandingCtx = createContext<BrandingValue>(DEFAULT_BRANDING);

export function BrandingProvider({ value, children }: { value: BrandingValue | null; children?: React.ReactNode }): React.ReactElement {
  const appName = value?.appName?.trim() || DEFAULT_BRANDING.appName;
  const orgName = value?.orgName ?? '';
  const logoUrl = value?.logoUrl ?? null;
  const faviconUrl = value?.faviconUrl ?? null;
  const memo = useMemo<BrandingValue>(() => ({ appName, orgName, logoUrl, faviconUrl }), [appName, orgName, logoUrl, faviconUrl]);
  return <BrandingCtx.Provider value={memo}>{children}</BrandingCtx.Provider>;
}

/** Identité visuelle courante (nom de l'app + URLs des images, ou null si non personnalisées). */
export function useBranding(): BrandingValue {
  return useContext(BrandingCtx);
}
