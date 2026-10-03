/**
 * PROFILS PAYS — /country-profiles/<CC>.json validés par Zod.
 * Tout ce qui touche devise / formats / identifiants / semaine / hégire vient d'ICI (aucune valeur codée en dur).
 * Ajouter un pays = déposer un JSON + le rendre `enabled` (puis le sélectionner dans Paramètres > Général).
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, env } from '../config';
import { countryProfileZ, type CountryProfile } from '@sardpi/shared';
import { getSection } from '../settings';

const cache = new Map<string, { profile: CountryProfile; mtimeMs: number }>();

export function listProfileCodes(): { code: string; enabled: boolean; name: unknown }[] {
  try {
    return fs
      .readdirSync(paths.countryProfiles)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => {
        const code = f.replace('.json', '');
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(paths.countryProfiles, f), 'utf8'));
          const p = countryProfileZ.parse(raw);
          return { code: p.code, enabled: p.enabled, name: p.name };
        } catch (e) {
          return { code, enabled: false, name: { fr: `⚠ profil invalide : ${(e as Error).message}` } };
        }
      });
  } catch {
    return [];
  }
}

export function getProfileByCode(code: string): { profile: CountryProfile | null; error?: string } {
  const file = path.join(paths.countryProfiles, `${code}.json`);
  try {
    const st = fs.statSync(file);
    const hit = cache.get(code);
    if (hit && hit.mtimeMs === st.mtimeMs) return { profile: hit.profile };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const profile = countryProfileZ.parse(raw);
    cache.set(code, { profile, mtimeMs: st.mtimeMs });
    return { profile };
  } catch (e) {
    return { profile: null, error: (e as Error).message };
  }
}

/** Profil actif : settings.general.country > env COUNTRY_PROFILE > DZ. */
export async function getActiveProfile(): Promise<{ profile: CountryProfile; code: string; error?: string }> {
  const g = (await getSection('general')) as { country?: string };
  const fromEnv = (process.env.COUNTRY_PROFILE ?? 'DZ').toUpperCase();
  const candidate = /^[A-Z]{2}$/.test(String(g.country ?? '')) ? String(g.country) : /^[A-Z]{2}$/.test(fromEnv) ? fromEnv : 'DZ';
  const final = candidate;
  const { profile, error } = getProfileByCode(final);
  if (profile) return { profile, code: final };
  const dz = getProfileByCode('DZ');
  return { profile: dz.profile!, code: 'DZ', error };
}

export function profileTimezone(p: CountryProfile | null): string {
  return p?.timezone ?? env.timezone;
}

/** Validation d'un identifiant patient selon le profil (NIN, téléphone…). */
export function validateWithProfile(p: CountryProfile, idKey: string, value: string): string | null {
  const list = (p.identifiers as { patient?: { key: string; pattern?: string }[] } | undefined)?.patient ?? [];
  const def = list.find((x) => x.key === idKey);
  if (!def?.pattern) return null;
  try {
    const re = new RegExp(def.pattern);
    return re.test(value) ? null : `pattern:${def.pattern}`;
  } catch {
    return null;
  }
}
