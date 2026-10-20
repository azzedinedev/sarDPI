// @vitest-environment happy-dom
/**
 * TEST DE NON-RÉGRESSION — page Paramètres (mise en page + comportement), rendu RÉEL en DOM.
 * -------------------------------------------------------------------------------------------
 * Trois défauts d'origine, corrigés par la refonte, sont verrouillés ici :
 *   1. colonne bridée `max-w-4xl` centrée → grandes marges vides sur poste large ;
 *   2. 15 sections empilées dans des onglets horizontaux qui débordaient, sans repère collant ;
 *   3. formulaires sans état d'enregistrement ni garde-fou (une saisie partait en cliquant ailleurs).
 * Le rendu passe par les mêmes providers que l'application et par un `api` simulé : le formulaire
 * est donc vérifié avec de vraies valeurs, et les actions (saisie, changement de section,
 * enregistrement, filtre) sont réellement déclenchées.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * framer-motion est remplacé par des composants transparents : les animations ne sont pas l'objet du
 * test, et le moteur réel émet dans happy-dom des « AbortError: The animation was canceled » à
 * l'unmount (bruit qui ferait échouer la suite). Le balisage et les rôles ARIA sont conservés.
 */
vi.mock('framer-motion', async () => {
  const R = await import('react');
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _h, whileTap: _p, layout: _l, layoutId: _lid, variants: _v, custom: _c, ...rest } = props;
    return R.createElement(tag, rest, children as React.ReactNode);
  };
  const motion = new Proxy({}, { get: (_target, tag: string) => passthrough(tag) });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children),
    MotionConfig: ({ children }: { children?: React.ReactNode }) => R.createElement(R.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dicts = {
  settings: JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/fr/settings.json'), 'utf8')) as Record<string, string>,
  common: JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/fr/common.json'), 'utf8')) as Record<string, string>,
};

const { I18nProvider } = await import('../apps/web/src/lib/i18n');
const { ToastProvider } = await import('../apps/web/src/components/toast');
const { api } = await import('../apps/web/src/lib/api');
const { default: SettingsPage } = await import('../apps/web/src/app/(app)/admin/settings/page');

/** Payloads réalistes (réponses de GET /admin/settings/:section). */
const GENERAL = {
  appName: 'sarDPI',
  country: 'DZ',
  orgName: 'Cabinet Boumerdès',
  orgAddress: 'Ctt. Ali-Mali, Boumerdès',
  orgPhone: '+213 24 00 00 00',
  orgEmail: 'contact@cabinet.dz',
  legalNotice: 'Loi 18-07',
  footerNote: 'sarDPI',
  dateDisplay: 'DD/MM/YYYY',
  timeDisplay: true,
};
const SECURITY = {
  captcha: { provider: 'internal' },
  passwordMinLength: 12,
  lockout: { maxAttempts: 5, stepsMinutes: [1, 5, 15, 60] },
  enforceTotpForAdmin: false,
  signedUrlTtlMin: 15,
  encryptSensitiveFields: true,
};
/** Étiquettes du calendrier : module autrefois éditable en JSON brut, désormais en formulaire + CRUD. */
const CALENDAR_KINDS = {
  kinds: [
    { key: 'consultation', order: 1, color: '#3b82f6', durationMin: 30, active: true, label: { fr: 'Consultation', ar: 'استشارة', es: 'Consulta', en: 'Consultation' } },
  ],
  statuses: [{ key: 'pending', order: 1, color: '#f59e0b', label: { fr: 'En attente', ar: 'قيد الانتظار', es: 'Pendiente', en: 'Pending' } }],
};
/** Interface & thèmes : le thème actif est « medical-blue » (dossier /themes/medical-blue). */
const UI = { theme: 'medical-blue', density: 'comfortable', nav: 'sidebar', animations: 'full', parallax: true, arabicDigits: false, hijriEnabled: true };
const PAYLOADS: Record<string, Record<string, unknown>> = { general: GENERAL, security: SECURITY, calendarKinds: CALENDAR_KINDS, ui: UI };

/**
 * Faux serveur : la lecture renvoie l'état courant, l'écriture le met à jour. C'est indispensable
 * ici — après un enregistrement, la page invalide sa requête et relit la section : un GET figé sur
 * l'ancienne valeur ferait croire à une saisie encore « non enregistrée ».
 */
const store: Record<string, Record<string, unknown>> = {};

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const put = api.put as unknown as ReturnType<typeof vi.fn>;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(): Promise<HTMLElement> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement('div');
  document.body.appendChild(host);
  const tree = React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(I18nProvider, {
      initialLang: 'fr',
      initialDicts: dicts,
      languages: [
        { code: 'fr', label: 'Français', dir: 'ltr' as const },
        { code: 'ar', label: 'العربية', dir: 'rtl' as const },
      ],
      children: React.createElement(ToastProvider, null, React.createElement(SettingsPage)),
    }),
  );
  await act(async () => {
    root = createRoot(host!);
    root.render(tree);
  });
  await flush(); // la requête de section se résout sur un macrotâche : on attend le formulaire réel
  return host;
}

function byText(sel: string, text: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? '').includes(text));
  if (!el) throw new Error(`introuvable : ${sel} contenant « ${text} »`);
  return el;
}

/** Saisie React contrôlée : passe par le setter natif puis émet un vrai évènement `input`. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

/** Laisse tourner les macrotâches (react-query notifie hors du cycle de rendu React). */
async function flush(ms = 5): Promise<void> {
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

const tab = (key: string): HTMLElement => document.getElementById(`settings-tab-${key}`)!;
const saveButton = (): HTMLButtonElement => byText('button', 'Enregistrer') as HTMLButtonElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // API DOM absentes de happy-dom mais utilisées par le Shell/les animations
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  for (const [k, v] of Object.entries(PAYLOADS)) store[k] = structuredClone(v);
  for (const k of ['ui', 'languages', 'codification', 'medicalRefs', 'smtp', 'gedTypes', 'practitionerTypes', 'workflowSteps', 'vaccination', 'captcha', 'backups', 'license']) store[k] ??= {};
  get.mockImplementation(async (p: string) => structuredClone(store[p.split('/').pop() ?? ''] ?? {}));
  put.mockImplementation(async (p: string, body: unknown) => {
    const key = p.split('/').pop() ?? '';
    store[key] = structuredClone(body as Record<string, unknown>);
    return { ok: true, section: key, value: store[key] };
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  document.body.innerHTML = '';
  get.mockReset();
  put.mockReset();
});

describe('page Paramètres — structure (pleine largeur, sous-menu collant)', () => {
  it('n’est plus bridée à max-w-4xl et occupe la largeur du conteneur', async () => {
    const el = await mount();
    expect(el.innerHTML).not.toContain('max-w-4xl');
    expect(el.innerHTML).toContain('flex min-w-0 flex-col gap-3 lg:flex-row');
  });

  it('sous-menu collant : colonne latérale groupée + bandeau de pastilles mobile, ancrés sous la topbar', async () => {
    const el = await mount();
    expect(el.querySelectorAll('.sticky-under-topbar').length).toBeGreaterThanOrEqual(2);
    expect(el.querySelector('.nav-scroll-x')).toBeTruthy();
    expect(el.querySelector('.nav-scroll-y')).toBeTruthy();
    const tablist = el.querySelector('[role="tablist"][aria-orientation="vertical"]')!;
    // 14 sections : le carnet vaccinal a quitté Paramètres pour Administration » Vaccination
    expect(tablist.querySelectorAll('[role="tab"]').length).toBe(14);
    for (const label of ['Plateforme', 'Activité clinique', 'Communication', 'Sécurité & conformité', 'Exploitation']) {
      expect(el.textContent, `regroupement « ${label} » absent`).toContain(label);
    }
    for (const label of ['Général', 'Interface & thèmes', 'Codification', 'E-mail (SMTP)', 'Référentiels médicaux', 'Licence']) {
      expect(el.textContent, `section « ${label} » absente`).toContain(label);
    }
  });

  it('le formulaire par défaut est en grille large et affiche les VALEURS du serveur (plus de squelette)', async () => {
    const el = await mount();
    expect(el.textContent).toContain(dicts.settings['settings.groups.identity']!);
    expect(el.querySelector('.skeleton')).toBeNull();
    const org = [...el.querySelectorAll('input')].find((i) => i.value === 'Cabinet Boumerdès');
    expect(org, 'valeur de la section non injectée dans le formulaire').toBeTruthy();
    expect(el.innerHTML).toContain('xl:grid-cols-4'); // la largeur libérée est bien exploitée
  });
});

describe('page Paramètres — enregistrement (barre collante, état, garde-fou)', () => {
  it('la barre est collante et l’état initial est « à jour » (rien à écrire)', async () => {
    const el = await mount();
    expect(el.innerHTML).toContain('sticky bottom-0');
    expect(el.textContent).toContain(dicts.settings['settings.save.upToDate']!);
    expect(saveButton().disabled).toBe(true);
  });

  it('signale les modifications, permet de rétablir, puis enregistre et revient à « à jour »', async () => {
    const el = await mount();
    const input = [...el.querySelectorAll('input')].find((i) => i.value === 'sarDPI')!;
    await type(input, 'sarDPI — Clinique');

    expect(el.textContent).toContain(dicts.settings['settings.save.dirty']!);
    expect(saveButton().disabled).toBe(false);

    await click(saveButton());
    expect(put, 'PUT non déclenché').toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0]! as [string, Record<string, unknown>];
    expect(url).toBe('/admin/settings/general');
    expect(body.appName).toBe('sarDPI — Clinique');
    expect(el.textContent).toContain(dicts.settings['settings.save.upToDate']!);

    await type(input, 'Autre nom');
    await click(byText('button', dicts.settings['settings.save.discard']!));
    expect(el.textContent).toContain(dicts.settings['settings.save.upToDate']!);
    expect(saveButton().disabled).toBe(true);
  });

  it('ne change pas de section sans confirmation quand une saisie est en cours', async () => {
    const el = await mount();
    const input = [...el.querySelectorAll('input')].find((i) => i.value === 'sarDPI')!;
    await type(input, 'Brouillon non enregistré');

    await click(tab('smtp'));
    // le changement est intercepté : la section courante reste affichée, une confirmation s'ouvre
    expect(tab('general').getAttribute('aria-selected')).toBe('true');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(dicts.settings['settings.save.leaveTitle']!);
    expect(dialog.textContent).toContain('Général'); // {section} interpolé dans l'avertissement

    await click(byText('[role="dialog"] button', dicts.settings['settings.save.stay']!));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // la saisie est intacte (le champ est contrôlé : sa valeur n'apparaît pas dans textContent)
    expect([...document.querySelectorAll('input')].some((i) => i.value === 'Brouillon non enregistré')).toBe(true);
    // aucune RELECTURE DE LA SECTION n'a écrasé la saisie (les autres appels — identité visuelle,
    // liste des thèmes — portent sur d'autres chemins et ne touchent pas au formulaire)
    const sectionCalls = (get.mock.calls as unknown[][]).filter((c) => String(c[0]).startsWith('/admin/settings/'));
    expect(sectionCalls).toHaveLength(1);

    await click(tab('smtp'));
    await click(byText('[role="dialog"] button', dicts.settings['settings.save.leaveGo']!));
    expect(tab('smtp').getAttribute('aria-selected')).toBe('true');
  });

  it('le filtre du sous-menu réduit la liste et signale l’absence de résultat', async () => {
    const el = await mount();
    const filter = [...el.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === dicts.settings['settings.nav.filter']!)!;
    await type(filter, 'smtp');
    expect([...document.querySelectorAll('nav [id^="settings-tab-"]')].map((n) => n.id)).toEqual(['settings-tab-smtp']);
    await type(filter, 'zzz-introuvable');
    expect(el.textContent).toContain(dicts.settings['settings.nav.empty']!);
  });
});

describe('page Paramètres — modules autrefois en JSON brut', () => {
  it('la sécurité s’édite par champs (plus de bloc JSON imposé) et respecte les bornes du serveur', async () => {
    const el = await mount();
    await click(tab('security'));

    const panel = document.getElementById('settings-panel') as HTMLElement;
    // les champs du module sont rendus avec leurs valeurs
    expect(panel.textContent).toContain(dicts.settings['settings.security.signedUrlTtlMin']!);
    expect(panel.textContent).toContain(dicts.settings['settings.security.stepsMinutes']!);
    expect([...panel.querySelectorAll('input')].some((i) => i.value === '1, 5, 15, 60')).toBe(true);
    // le JSON reste accessible en mode avancé (même validation)
    expect(panel.textContent).toContain(dicts.settings['settings.jsonAdvanced']!);

    // une valeur hors bornes est signalée champ par champ et bloque l'enregistrement
    const ttl = [...panel.querySelectorAll('input')].find((i) => i.type === 'number')!;
    await type(ttl, '5000');
    expect(panel.textContent).toContain(dicts.settings['settings.save.invalid']!.replace('{n}', '1'));
    expect(saveButton().disabled).toBe(true);
    await click(saveButton());
    expect(put).not.toHaveBeenCalled();

    // corriger la valeur réactive l'enregistrement, et la charge utile part au format attendu
    await type(ttl, '30');
    await click(saveButton());
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0]! as [string, Record<string, unknown>];
    expect(url).toBe('/admin/settings/security');
    expect(body.signedUrlTtlMin).toBe(30);
    expect(body.lockout).toMatchObject({ maxAttempts: 5, stepsMinutes: [1, 5, 15, 60] });
  });

  it('CRUD d’une liste : ajout d’un type de RDV, validation de la clé, enregistrement', async () => {
    const el = await mount();
    await click(tab('calendarKinds'));
    const panel = document.getElementById('settings-panel') as HTMLElement;

    // la liste existante est affichée (clé + libellé)
    expect(panel.textContent).toContain('consultation');
    expect(panel.textContent).toContain('Consultation');

    // --- ajout : le tiroir s'ouvre, la clé est saisie puis un libellé
    await click(byText('button', dicts.settings['settings.crud.add']!));
    const dialog = (): HTMLElement => document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog().textContent).toContain('Nouvelle entrée');
    await type(dialog().querySelector('input')!, 'Radio');
    // clé en majuscules : refusée par le schéma partagé (elle est stockée dans appointments.kind)
    expect(dialog().textContent).toContain(dicts.settings['settings.validation.kindKey']!);
    await type(dialog().querySelector('input')!, 'radio');
    const labelInput = [...dialog().querySelectorAll('input')].find((i) => i.getAttribute('aria-label')?.startsWith(dicts.settings['settings.field.label']!))!;
    await type(labelInput, 'Radiologie');
    await click(byText('[role="dialog"] button', dicts.common.save!));
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // --- la ligne ajoutée est visible et part dans la charge utile
    expect(panel.textContent).toContain('radio');
    expect(panel.textContent).toContain('Radiologie');
    await click(saveButton());
    const [, body] = put.mock.calls[0]! as [string, { kinds: { key: string; order: number; label: Record<string, string> }[] }];
    expect(body.kinds.map((k) => k.key)).toEqual(['consultation', 'radio']);
    expect(body.kinds[1]).toMatchObject({ order: 2, label: { fr: 'Radiologie' } });

    // --- réordonnancement (la ligne ajoutée remonte en tête, l'ordre suit la position)
    const up = [...panel.querySelectorAll('button')].filter((b) => b.title === dicts.settings['settings.crud.moveUp']!);
    await click(up[1]!);
    await click(saveButton());
    const [, body2] = put.mock.calls[1]! as [string, { kinds: { key: string; order: number }[] }];
    expect(body2.kinds.map((k) => k.key)).toEqual(['radio', 'consultation']);
    expect(body2.kinds.map((k) => k.order)).toEqual([1, 2]);
  });
});

/* ----------------------------------------------------------------------------------------
 * Identité visuelle (logo / icône) et sélecteur de thème visuel.
 * Deux champs autrefois muets ou libres :
 *   - le thème était une ZONE DE TEXTE (nom de dossier à taper, aucune liste, aucun contrôle) ;
 *   - le logo n'existait pas (monogramme « S » codé en dur dans la barre latérale et la connexion).
 * -------------------------------------------------------------------------------------- */
describe('Paramètres — identité visuelle et thème', () => {
  it('le champ « Thème » est un sélecteur alimenté par les thèmes découverts dans /themes/', async () => {
    store['names'] = {
      active: 'medical-blue',
      themes: [
        { name: 'medical-blue', label: 'Bleu médical', accent: '#0ea5b7', modes: ['light', 'dark'], version: '1.0.0' },
        { name: 'clinical-green', label: 'Vert clinique', accent: '#16a06e', modes: ['light'], version: '1.0.0' },
      ],
      issues: [],
    };
    const el = await mount();
    await click(tab('ui'));

    const theme = [...el.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'clinical-green'));
    expect(theme, 'sélecteur de thème absent').toBeTruthy();
    expect([...theme!.options].map((o) => o.value)).toEqual(['medical-blue', 'clinical-green']);
    expect(theme!.value).toBe('medical-blue');
    expect(el.textContent).toContain('Bleu médical'); // nom d'affichage traduit, pas seulement le dossier
    // plus aucune saisie libre du nom de dossier
    expect([...el.querySelectorAll('input')].some((i) => i.value === 'medical-blue')).toBe(false);
  });

  it('un thème enregistré mais introuvable reste sélectionné et signalé (pas de réécriture muette)', async () => {
    store['names'] = { active: 'vieux-theme', themes: [{ name: 'medical-blue', label: 'Bleu médical' }], issues: [] };
    store['ui'] = { ...UI, theme: 'vieux-theme' };
    const el = await mount();
    await click(tab('ui'));

    const theme = [...el.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'vieux-theme'));
    expect(theme, 'valeur enregistrée perdue du sélecteur').toBeTruthy();
    expect(theme!.value).toBe('vieux-theme');
    expect(el.textContent).toContain(dicts.settings['settings.theme.missing']!);
  });

  it('les dossiers rejetés par le scan sont signalés (un thème invalide est ignoré, pas appliqué)', async () => {
    store['names'] = {
      active: 'medical-blue',
      themes: [{ name: 'medical-blue', label: 'Bleu médical' }],
      issues: [{ dir: 'casse', error: 'manifeste invalide — version: requis' }],
    };
    const el = await mount();
    await click(tab('ui'));
    expect(el.textContent).toContain('/themes/casse');
    expect(el.textContent).toContain('manifeste invalide');
  });

  it('section Général : logo ET icône d’onglet téléversables, types image imposés', async () => {
    store['branding'] = { appName: 'sarDPI', orgName: 'Cabinet Boumerdès', logo: null, favicon: null };
    const el = await mount(); // la section par défaut est « general »
    expect(el.textContent).toContain(dicts.settings['settings.groups.branding']!);
    const files = [...el.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(files, 'champs de téléversement absents').toHaveLength(2);
    for (const f of files) {
      expect(f.accept).toContain('image/png');
      expect(f.accept).toContain('image/svg+xml');
    }
    // sans logo personnalisé : l’état « par défaut » est affiché, aucune image cassée
    expect(el.textContent).toContain(dicts.settings['settings.branding.default']!);
    expect(el.querySelectorAll('img[src^="/api/v1/branding/"]').length).toBe(0);
  });

  it('un logo déjà en place est prévisualisé avec son empreinte de diffusion (?v=)', async () => {
    store['branding'] = {
      appName: 'sarDPI',
      orgName: 'Cabinet Boumerdès',
      logo: { kind: 'logo', path: 'branding/logo-ab12.png', rev: 'ab12', mime: 'image/png', sizeBytes: 20480, url: '/api/v1/branding/logo?v=ab12' },
      favicon: null,
    };
    const el = await mount();
    const img = el.querySelector<HTMLImageElement>('img[src="/api/v1/branding/logo?v=ab12"]');
    expect(img, 'aperçu du logo absent').toBeTruthy();
    expect(el.textContent).toContain(dicts.settings['settings.branding.inUse']!);
    expect(el.textContent).toContain('20 Ko');
  });
});
