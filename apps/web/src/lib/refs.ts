'use client';
/**
 * Listes médicales configurables (groupes sanguins, caisses SS) et pays disponibles (profils
 * /country-profiles). Libellés traduits selon la langue active — le CODE reste stocké en base.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { pickLabel } from '@sardpi/shared';

export interface RefItemLite {
  code: string;
  label: Record<string, string>;
  active?: boolean;
}
interface MedicalRefs {
  bloodGroups: RefItemLite[];
  ssFunds: RefItemLite[];
}

/** Wilayas (régions) — pour l'autocomplétion par NOM ; le code numérique reste la valeur stockée. */
export interface RegionLite { code: string; fr: string; ar: string; parent: number | null }
export function useWilayas(): { wilayaOptions: { value: string; label: string; sublabel?: string }[]; wilayaLabel: (code: unknown) => string } {
  const i18n = useI18n();
  const q = useQuery({
    queryKey: ['refs', 'regions', 'wilaya'],
    staleTime: 24 * 3600_000,
    retry: false,
    queryFn: () => api.get<{ rows: RegionLite[] }>('/refs/regions?kind=wilaya'),
  });
  const wilayas = q.data?.rows ?? [];
  const ar = i18n.lang === 'ar';
  const wilayaOptions = wilayas.map((w) => ({ value: String(w.code), label: (ar ? w.ar || w.fr : w.fr) || String(w.code), sublabel: String(w.code) }));
  const wilayaLabel = (code: unknown): string => {
    if (code == null || code === '') return '—';
    const w = wilayas.find((x) => Number(x.code) === Number(code));
    return w ? (ar ? w.ar || w.fr : w.fr) : String(code);
  };
  return { wilayaOptions, wilayaLabel };
}

export function useMedicalRefs(): {
  bloodGroups: RefItemLite[];
  ssFunds: RefItemLite[];
  bloodLabel: (code: unknown) => string;
  fundLabel: (code: unknown) => string;
  bloodOptions: { value: string; label: string }[];
  fundOptions: { value: string; label: string }[];
} {
  const { lang } = useI18n();
  const q = useQuery({ queryKey: ['refs', 'medical'], queryFn: () => api.get<MedicalRefs>('/refs/medical'), staleTime: 300_000 });
  const groups = q.data?.bloodGroups ?? [];
  const funds = q.data?.ssFunds ?? [];
  const lab = (items: RefItemLite[], code: unknown): string => {
    const c = String(code ?? '');
    if (!c) return '—';
    const it = items.find((x) => x.code === c);
    return it ? pickLabel(it.label, lang) : c;
  };
  const opts = (items: RefItemLite[]): { value: string; label: string }[] => [
    { value: '', label: '—' },
    ...items.map((x) => ({ value: x.code, label: pickLabel(x.label, lang) })),
  ];
  return {
    bloodGroups: groups,
    ssFunds: funds,
    bloodLabel: (c) => lab(groups, c),
    fundLabel: (c) => lab(funds, c),
    bloodOptions: opts(groups),
    fundOptions: opts(funds),
  };
}

export interface CountryLite {
  code: string;
  name: Record<string, string>;
}

export function useCountries(): { countries: CountryLite[]; countryOptions: { value: string; label: string }[]; countryLabel: (code: unknown) => string } {
  const { lang } = useI18n();
  const q = useQuery({ queryKey: ['refs', 'countries'], queryFn: () => api.get<{ countries: CountryLite[] }>('/refs/countries'), staleTime: 600_000 });
  const countries = q.data?.countries ?? [];
  return {
    countries,
    countryOptions: [
      { value: '', label: '—' },
      ...countries.map((c) => ({ value: c.code, label: `${c.code} · ${pickLabel(c.name, lang)}` })),
    ],
    countryLabel: (code: unknown): string => {
      const c = String(code ?? '');
      if (!c) return '—';
      const it = countries.find((x) => x.code === c);
      return it ? `${c} · ${pickLabel(it.name, lang)}` : c;
    },
  };
}
