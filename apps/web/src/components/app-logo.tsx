'use client';
/**
 * LOGO DE L'APPLICATION — un seul composant pour la barre latérale, l'écran de connexion, les
 * en-têtes imprimables et les PDF. Si l'administrateur a téléversé un logo (Paramètres » Général »
 * Identité visuelle), il est affiché ; sinon le monogramme historique (première lettre du nom de
 * l'application sur fond primaire) prend le relais — aucun écran ne reste sans identité.
 *
 * `next/image` n'est volontairement pas utilisé : l'image vient de l'API de l'application (taille
 * inconnue au build, aucun optimizeur distant autorisé en on-premise) et un `<img>` simple évite
 * tout appel au service d'optimisation.
 */
import React from 'react';
import { useBranding } from '@/lib/branding';
import { cn } from '@/lib/utils';

export interface AppLogoProps {
  /** côté du bloc visuel en px (carré) */
  size?: number;
  /** affiche le nom de l'application à côté du logo */
  withText?: boolean;
  /** texte sous le nom (organisation, « DPI · Mode démo »…) */
  subtitle?: React.ReactNode;
  /** classes du conteneur visuel (arrondi, ombre) */
  boxClassName?: string;
  className?: string;
  textClassName?: string;
  /** classes du sous-titre (défaut : petites capitales espacées, comme la barre latérale) */
  subtitleClassName?: string;
  /** taille du nom en px (défaut 14.5) */
  nameSize?: number;
}

export function AppLogo({
  size = 36,
  withText = false,
  subtitle,
  boxClassName,
  className,
  textClassName,
  subtitleClassName,
  nameSize = 14.5,
}: AppLogoProps): React.ReactElement {
  const { appName, logoUrl } = useBranding();
  const initial = (appName || 'S').trim().charAt(0).toUpperCase() || 'S';
  const px = { width: size, height: size } as const;

  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={withText ? '' : appName}
          width={size}
          height={size}
          style={px}
          className={cn('shrink-0 rounded-2xl object-contain', boxClassName)}
        />
      ) : (
        <span
          aria-hidden={withText}
          style={{ ...px, fontSize: Math.round(size * 0.52) }}
          className={cn(
            'grid shrink-0 place-items-center rounded-2xl bg-[rgb(var(--c-primary))] font-bold text-[rgb(var(--c-primary-ink))] shadow-[var(--shadow-glow)]',
            boxClassName,
          )}
        >
          {initial}
        </span>
      )}
      {withText ? (
        <span className={cn('min-w-0', textClassName)}>
          <span className="block truncate font-bold leading-tight" style={{ fontSize: nameSize }}>
            {appName}
          </span>
          {subtitle ? (
            <span className={cn('block truncate text-[10.5px] font-medium uppercase tracking-wide text-[rgb(var(--c-muted))]', subtitleClassName)}>{subtitle}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
