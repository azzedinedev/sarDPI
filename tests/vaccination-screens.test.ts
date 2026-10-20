// @vitest-environment happy-dom
/**
 * ÉCRANS DU CARNET VACCINAL — rendu RÉEL en DOM (Administration » Vaccination + onglet du dossier).
 * -----------------------------------------------------------------------------------------------
 * La vaccination n'était qu'une liste de vaccins dans Paramètres, sans aucun lien avec les patients.
 * Elle est devenue un module : un écran d'administration (calendrier + tous les carnets) et un onglet
 * du dossier patient (couverture, échéances, saisie des doses). Ces tests verrouillent ce que
 * l'API seule ne prouve pas :
 *   1. les DEUX onglets existent et le calendrier s'édite avec le même formulaire que les réglages ;
 *   2. les compteurs et les libellés de vaccins viennent du serveur (pas de texte codé en dur) ;
 *   3. la vue transversale affiche le PATIENT de chaque dose (le rattachement au dossier est visible) ;
 *   4. l'onglet du dossier affiche la couverture (états, retards, synthèse) et le bouton de génération ;
 *   5. le RBAC masque ce qui n'est pas autorisé (aucun bouton mort) : sans `setting:view` l'onglet
 *      calendrier disparaît, sans `vaccination:view` le carnet est refusé poliment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* animations : composés transparents (framer-motion émet des AbortError sous happy-dom) */
vi.mock('framer-motion', async () => {
  const R = await import('react');
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _w, layout: _l, layoutId: _lid, variants: _v, custom: _c, ...rest } = props;
    return R.createElement(tag, rest, children as React.ReactNode);
  };
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children as React.ReactNode),
    MotionConfig: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children as React.ReactNode),
    useReducedMotion: () => true,
  };
});

/* routeur : instance STABLE (une nouvelle URLSearchParams à chaque rendu relancerait les effets) */
const SEARCH_PARAMS = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/admin/vaccination',
  useSearchParams: () => SEARCH_PARAMS,
  useParams: () => ({ id: '4' }),
}));
vi.mock('next/link', async () => {
  const R = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => R.createElement('a', { href, ...rest }, children as React.ReactNode),
  };
});

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), upload: vi.fn(), download: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dicts = Object.fromEntries(
  ['settings', 'common', 'patient', 'errors'].map((ns) => [ns, JSON.parse(fs.readFileSync(path.join(ROOT, `locales/fr/${ns}.json`), 'utf8')) as Record<string, string>]),
);

/** Libellé traduit attendu (échoue proprement si la clé manque au dictionnaire). */
function tk(ns: 'settings' | 'common' | 'patient' | 'errors', key: string): string {
  const v = dicts[ns]?.[key];
  if (!v) throw new Error(`clé de test manquante : ${ns}/${key}`);
  return v;
}

const { I18nProvider } = await import('../apps/web/src/lib/i18n');
const { ToastProvider } = await import('../apps/web/src/components/toast');
const { api } = await import('../apps/web/src/lib/api');
const { useAuth } = await import('../apps/web/src/stores/auth');
const { DEFAULT_VACCINATION_SCHEDULE } = await import('@sardpi/shared');
const { default: AdminVaccinationPage } = await import('../apps/web/src/app/(app)/admin/vaccination/page');
const { VaccinationTab } = await import('../apps/web/src/components/vaccination-tab');

/* ------------------------------------------------------------------ données simulées */

const SCHEDULE = [
  { key: 'bcg', label: { fr: 'BCG (tuberculose)', ar: 'BCG', es: 'BCG', en: 'BCG' }, ageLabel: 'Naissance', ageMonths: 0, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'penta1', label: { fr: 'Pentavalent 1', ar: 'خماسي 1', es: 'Pentavalente 1', en: 'Pentavalent 1' }, ageLabel: '6 semaines', ageMonths: 0, ageWeeks: 6, doses: 1, intervalDays: 0, mandatory: true, active: true },
  { key: 'mmr1', label: { fr: 'ROR 1', ar: 'ثلاثي 1', es: 'SRP 1', en: 'MMR 1' }, ageLabel: '18 mois', ageMonths: 18, ageWeeks: 0, doses: 1, intervalDays: 0, mandatory: true, active: true },
];

const STATS = { total: 4, done: 1, planned: 3, patients: 1, enabled: true, scheduleCount: SCHEDULE.length, mandatoryCount: 3, expectedDoses: 3 };

const DOSES = {
  rows: [
    { id: 1, code: 'VAX-000001', patient_id: 4, patient_code: 'PAT-00004', patient_name: 'BENALI Amina', vaccine_key: 'bcg', vaccine_label: 'BCG (tuberculose)', vaccine_mandatory: true, dose_no: 1, status: 'done', administered_at: '2015-01-20', due_at: '2015-01-19', practitioner_name: 'Dr. Merabet', batch: 'LOT-1', archived_at: null },
    { id: 2, code: 'VAX-000002', patient_id: 4, patient_code: 'PAT-00004', patient_name: 'BENALI Amina', vaccine_key: 'penta1', vaccine_label: 'Pentavalent 1', dose_no: 1, status: 'planned', administered_at: null, due_at: '2015-03-02', archived_at: null },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
};

const CARNET = {
  patient: { id: 4, code: 'PAT-00004', fullName: 'BENALI Amina', birthDate: '2015-01-19' },
  enabled: true,
  summary: { vaccines: 3, mandatory: 3, complete: 1, overdue: 1, dosesDone: 1, dosesExpected: 3, percent: 33 },
  coverage: [
    { key: 'bcg', label: 'BCG (tuberculose)', ageLabel: 'Naissance', mandatory: true, dosesTotal: 1, done: 1, state: 'complete', overdue: false, nextDoseNo: null, nextDueAt: null },
    { key: 'penta1', label: 'Pentavalent 1', ageLabel: '6 semaines', mandatory: true, dosesTotal: 1, done: 0, state: 'due', overdue: true, nextDoseNo: 1, nextDueAt: '2015-03-02' },
    { key: 'mmr1', label: 'ROR 1', ageLabel: '18 mois', mandatory: true, dosesTotal: 1, done: 0, state: 'upcoming', overdue: false, nextDoseNo: 1, nextDueAt: '2016-07-19' },
  ],
  doses: DOSES.rows,
};

const routes: Record<string, unknown> = {
  '/vaccinations/stats': STATS,
  '/admin/settings/vaccination': { enabled: true, schedule: SCHEDULE },
  '/vaccinations/calendar': { enabled: true, schedule: SCHEDULE.map((s) => ({ ...s, label: s.label.fr })) },
  '/vaccinations': DOSES,
  '/patients/4/vaccination': CARNET,
  '/refs/display': { dateDisplay: 'DD/MM/YYYY', timeDisplay: true, steps: [] },
  '/practitioners': { rows: [] },
  '/locations': { rows: [] },
  '/patients': { rows: [{ id: 4, code: 'PAT-00004', first_name: 'Amina', last_name: 'BENALI', birth_date: '2015-01-19' }] },
};

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const put = api.put as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function flush(ms = 8): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
  await flush();
}

function byText(sel: string, text: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? '').includes(text));
  if (!el) throw new Error(`introuvable : ${sel} contenant « ${text} »`);
  return el;
}

function setPerms(perms: string[]): void {
  useAuth.setState({
    perms,
    status: 'authed',
    has: (m: string, a = 'view') => perms.includes('*') || perms.includes(`${m}.${a}`) || perms.includes(`${m}.*`) || perms.some((p) => p === `*.${a}`),
  } as never);
}

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  const tree = React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(I18nProvider, {
      initialLang: 'fr',
      initialDicts: dicts,
      languages: [{ code: 'fr', label: 'Français', dir: 'ltr' as const }],
      children: React.createElement(ToastProvider, null, node),
    }),
  );
  await act(async () => {
    root = createRoot(host!);
    root.render(tree);
  });
  await flush();
  return host;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  setPerms(['*']);
  get.mockReset();
  put.mockReset();
  post.mockReset();
  get.mockImplementation(async (p: string) => {
    const clean = String(p).split('?')[0]!;
    return structuredClone(routes[clean] ?? {});
  });
  put.mockImplementation(async (p: string, body: unknown) => ({ ok: true, section: p.split('/').pop(), value: body }));
  post.mockImplementation(async () => ({ ok: true, created: 2, skipped: 1, plan: 3 }));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});

describe('Administration » Vaccination', () => {
  it('affiche les deux onglets (calendrier + carnets) et les compteurs servis par l’API', async () => {
    const el = await mount(React.createElement(AdminVaccinationPage));
    expect(el.textContent).toContain(tk('settings', 'admin.vaccination'));
    expect(el.textContent).toContain(tk('settings', 'vaccination.tab.schedule'));
    expect(el.textContent).toContain(tk('settings', 'vaccination.tab.doses'));
    // compteurs : vaccins au calendrier, doses administrées, patients suivis
    expect(el.textContent).toContain(String(STATS.scheduleCount));
    expect(el.textContent).toContain(String(STATS.done));
    expect(el.textContent).toContain(tk('settings', 'vaccination.stat.patients'));
  });

  it('le calendrier s’édite avec le formulaire des réglages (clés + libellés traduits)', async () => {
    const el = await mount(React.createElement(AdminVaccinationPage));
    // tableau de la liste éditable : clé technique en mono + libellé
    expect(el.textContent).toContain('bcg');
    expect(el.textContent).toContain('BCG (tuberculose)');
    expect(el.textContent).toContain('Pentavalent 1');
    // interrupteur d'activation du carnet + barre d'enregistrement à l'état « à jour »
    expect(el.querySelectorAll('input[type="checkbox"], [role="switch"]').length).toBeGreaterThan(0);
    expect(el.textContent).toContain(tk('settings', 'settings.save.upToDate'));
    expect(el.textContent).toContain(tk('settings', 'vaccination.restoreNational'));
  });

  it('« Restaurer le calendrier national » réécrit le réglage avec le calendrier du profil pays', async () => {
    const el = await mount(React.createElement(AdminVaccinationPage));
    await click(byText('button', tk('settings', 'vaccination.restoreNational')));
    // la confirmation explique l'effet (nombre de vaccins) avant d'écrire
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(String(DEFAULT_VACCINATION_SCHEDULE.length));
    await click(byText('[role="dialog"] button', tk('settings', 'vaccination.restoreNational')));
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0] as [string, { enabled: boolean; schedule: unknown[] }];
    expect(url).toBe('/admin/settings/vaccination');
    expect(body.enabled).toBe(true);
    expect(body.schedule).toHaveLength(DEFAULT_VACCINATION_SCHEDULE.length);
    expect(el.textContent).toBeTruthy();
  });

  it('onglet « Carnets » : chaque dose montre le PATIENT rattaché et le libellé du vaccin', async () => {
    const el = await mount(React.createElement(AdminVaccinationPage));
    await click(byText('[role="tab"]', tk('settings', 'vaccination.tab.doses')));
    await flush(20);
    expect(el.textContent).toContain('BENALI Amina'); // rattachement au dossier patient visible
    expect(el.textContent).toContain('PAT-00004');
    expect(el.textContent).toContain('BCG (tuberculose)');
    expect(el.textContent).toContain(tk('patient', 'vax.status.done'));
    expect(el.textContent).toContain(tk('patient', 'vax.status.planned'));
  });

  it('sans droit « setting » : l’onglet calendrier disparaît (pas de bouton mort)', async () => {
    setPerms(['vaccination.view', 'vaccination.create']);
    const el = await mount(React.createElement(AdminVaccinationPage));
    expect(el.textContent).toContain(tk('settings', 'vaccination.tab.doses'));
    expect(el.textContent).not.toContain(tk('settings', 'vaccination.restoreNational'));
    // un seul onglet autorisé : la barre d'onglets disparaît (rien à choisir), le contenu reste affiché
    expect(document.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(el.textContent).toContain(tk('settings', 'vaccination.tab.doses'));
  });
});

describe('Dossier patient » onglet Vaccination', () => {
  it('couverture : synthèse, états par vaccin et prochaine échéance', async () => {
    const el = await mount(React.createElement(VaccinationTab, { pid: 4 }));
    expect(el.textContent).toContain(tk('patient', 'vax.coverage'));
    // synthèse « 1/3 doses »
    expect(el.textContent).toContain('1/3');
    // états traduits : complet, à faire (retard), à venir
    expect(el.textContent).toContain(tk('patient', 'vax.state.complete'));
    expect(el.textContent).toContain(tk('patient', 'vax.state.overdue'));
    expect(el.textContent).toContain(tk('patient', 'vax.state.upcoming'));
    // retard signalé explicitement
    expect(el.textContent).toContain(tk('patient', 'vax.summary.overdue').replace('{count}', '1'));
    // date de naissance rappelée (source des échéances)
    expect(el.textContent).toContain('2015-01-19');
  });

  it('« Générer le calendrier » appelle l’endpoint du patient', async () => {
    const el = await mount(React.createElement(VaccinationTab, { pid: 4 }));
    await click(byText('button', tk('patient', 'vax.generate')));
    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0] as [string])[0]).toBe('/patients/4/vaccination/generate');
    expect(el.textContent).toContain(tk('patient', 'vax.doses'));
  });

  it('les doses du patient sont listées sous la couverture (scope patient, libellés du calendrier)', async () => {
    const el = await mount(React.createElement(VaccinationTab, { pid: 4 }));
    await flush(20);
    expect(el.textContent).toContain('VAX-000001');
    expect(el.textContent).toContain('Pentavalent 1');
    // la colonne « patient » n'a pas lieu d'être dans le dossier du patient
    expect(el.textContent).not.toContain(tk('patient', 'vax.patient.search'));
  });

  it('sans droit « vaccination:view » : refus explicite, pas de données demandées', async () => {
    setPerms(['patient.view']);
    const el = await mount(React.createElement(VaccinationTab, { pid: 4 }));
    expect(el.textContent).toContain(tk('patient', 'vax.forbidden'));
    expect(el.textContent).toContain(tk('patient', 'vax.forbiddenHint'));
    const called = (get.mock.calls as unknown[][]).some((c) => String(c[0]).includes('/vaccination'));
    expect(called, 'le carnet ne doit même pas être demandé').toBe(false);
  });
});
