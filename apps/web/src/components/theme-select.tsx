'use client';
/**
 * SÉLECTEUR DE THÈME VISUEL — Paramètres » Interface & thèmes.
 * ------------------------------------------------------------
 * Le champ « Thème (dossier /themes/) » était une zone de texte libre : un nom de dossier à taper
 * sans aide, donc un thème inexistant = silence du moteur (repli discret sur `medical-blue`) et un
 * administrateur qui croit son choix appliqué. Ce sélecteur liste les thèmes RÉELLEMENT découverts
 * dans `/themes/` (via `GET /admin/themes/names`, qui relit le même scan que la page
 * Administration » Thèmes) avec leur nom d'affichage traduit, leur accent et leurs modes.
 *
 * Deux garde-fous :
 *  - un thème enregistré mais introuvable (dossier renommé/supprimé, manifeste invalide) reste
 *    sélectionné et est signalé « introuvable » — la valeur n'est pas réécrite à l'insu de l'admin ;
 *  - les dossiers rejetés par le scan sont listés en avertissement (le moteur ignore un thème
 *    invalide, il ne plante pas).
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Palette } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Select } from '@/components/ui';

interface ThemeName {
  name: string;
  label: string;
  accent?: string | null;
  modes?: string[];
  version?: string;
  author?: string | null;
  jsApproved?: boolean;
  hasCustomCss?: boolean;
}
interface ThemesNames {
  active?: string;
  themes?: ThemeName[];
  issues?: { dir: string; error: string }[];
  scannedAt?: string;
}

export function ThemeSelect({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }): React.ReactElement {
  const { t } = useT('settings');
  const q = useQuery({ queryKey: ['themes-names'], queryFn: () => api.get<ThemesNames>('/admin/themes/names') });
  const themes = useMemo<ThemeName[]>(() => (Array.isArray(q.data?.themes) ? q.data!.themes! : []), [q.data]);
  const current = themes.find((x) => x.name === value) ?? null;

  const options = useMemo(() => {
    const list = themes.map((x) => ({ value: x.name, label: x.label && x.label !== x.name ? `${x.label} · ${x.name}` : x.name }));
    // thème enregistré mais absent du scan : conservé tel quel + signalé (jamais de réécriture muette)
    if (value && !themes.some((x) => x.name === value)) list.push({ value, label: `${value} — ${t('settings.theme.missing')}` });
    return list;
  }, [themes, value, t]);

  const issues = q.data?.issues ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={value}
        disabled={disabled || q.isLoading}
        onChange={(e) => onChange(e.target.value)}
        options={options.length ? options : [{ value, label: value || t('settings.theme.none') }]}
        aria-label={t('settings.theme')}
      />
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[rgb(var(--c-muted))]">
        {current?.accent ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 rounded-full ring-1 ring-[rgb(var(--c-line))]" style={{ background: current.accent }} />
            {current.accent}
          </span>
        ) : null}
        {current?.modes?.length ? <span>{t('settings.theme.modes')}: {current.modes.join(' · ')}</span> : null}
        {current?.version ? <span dir="ltr">v{current.version}</span> : null}
        {!q.isLoading && !themes.length ? <span className="font-semibold text-[rgb(var(--c-amber))]">{t('settings.theme.empty')}</span> : null}
        {value && !current && themes.length ? <span className="font-semibold text-[rgb(var(--c-amber))]">{t('settings.theme.missing')}</span> : null}
        <Link href="/admin/themes" className="ms-auto inline-flex items-center gap-1 font-semibold text-[rgb(var(--c-primary))] hover:underline">
          <Palette size={12} /> {t('settings.theme.manage')} <ExternalLink size={11} />
        </Link>
      </div>
      {issues.length ? (
        <ul className="flex flex-col gap-0.5 rounded-xl bg-[rgb(var(--c-amber-soft))] px-2.5 py-1.5 text-[11px] font-semibold text-[rgb(var(--c-amber))]">
          {issues.slice(0, 4).map((i) => (
            <li key={`${i.dir}:${i.error}`} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span dir="ltr">/themes/{i.dir}</span> — {i.error}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
