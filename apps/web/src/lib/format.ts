/** Formatage Intl piloté par le profil pays (devise, dates — grégorien/hijri optionnel, chiffres). */
'use client';
import type { CountryProfile } from '@sardpi/shared';

let profile: CountryProfile | null = null;

export function setCountryProfile(p: CountryProfile | null): void {
  profile = p;
}
export function countryProfile(): CountryProfile | null {
  return profile;
}

const caches = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function memo<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let v = caches.get(key);
  if (!v) {
    v = make();
    caches.set(key, v);
  }
  return v as T;
}

export function fmtDate(value: string | number | Date | null | undefined, lang: string, calendar?: 'gregory' | 'islamic-umalqura'): string {
  if (!profile || value === null || value === undefined) return '';
  const loc = `${lang}${calendar && calendar !== 'gregory' ? `-u-ca-${calendar === 'islamic-umalqura' ? 'islamic-umalqura' : calendar}` : ''}`;
  const dt = memo(`${loc}|d`, () =>
    new Intl.DateTimeFormat(loc, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      numberingSystem: (profile?.numbers as { digits?: string } | undefined)?.digits === 'arab' ? 'arab' : 'latn',
    }),
  ).format(new Date(value));
  return dt;
}

export function fmtDateTime(value: string | number | Date | null | undefined, lang: string): string {
  if (value === null || value === undefined) return '';
  const dt = memo(`${lang}|dt`, () => new Intl.DateTimeFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, numberingSystem: 'latn' })).format(new Date(value));
  return dt;
}

export function fmtMoney(centsAmount: number | null | undefined, lang: string): string {
  if (!profile || centsAmount === null || centsAmount === undefined) return '';
  const nf = memo(`${lang}|m`, () =>
    new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: profile!.currency.code,
      minimumFractionDigits: profile!.currency.decimals,
      maximumFractionDigits: profile!.currency.decimals,
      numberingSystem: (profile!.numbers as { digits?: string }).digits === 'arab' ? 'arab' : 'latn',
    }),
  );
  return nf.format(centsAmount / 10 ** profile.currency.decimals);
}

export function age(birth: string | null | undefined): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}

/** Semaine de travail (weekend profil pays) pour le calendrier. */
export function workingDays(): number[] {
  const weekend = new Set(((profile?.calendar as { weekendDays?: number[] } | undefined)?.weekendDays ?? [5, 6]));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.has(d));
}

export function relTime(iso: string, lang: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(-h, 'hour');
  return rtf.format(-Math.round(h / 24), 'day');
}
