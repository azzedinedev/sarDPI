'use client';
/**
 * Fil d'Ariane + bouton de retour mis en évidence.
 * --------------------------------------------------
 * Le chemin est dérivé de l'URL (aucune requête supplémentaire) : chaque segment statique est
 * traduit via les clés « nav.* », les segments dynamiques (identifiants) sont affichés tels quels
 * en chasse fixe — c'est le comportement attendu pour un fil de dossiers médicaux.
 * Le bouton de retour indique SA cible (« Retour · Patients ») : on sait toujours où l'on revient.
 * RTL : les propriétés logiques (ms-/me-, border-s) et l'icône inversée suivent la direction.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronRight, Home } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Crumb {
  href: string;
  label: string;
  /** Segment dynamique (identifiant) : affiché en mono, isolé pour rester LTR dans un texte RTL. */
  isId?: boolean;
  current?: boolean;
}

/** Segments statiques → clé i18n (namespace « common »). */
const STATIC: Record<string, string> = {
  dashboard: 'nav.dashboard',
  patients: 'nav.patients',
  calendar: 'nav.calendar',
  records: 'nav.records',
  lab: 'nav.lab',
  pharmacy: 'nav.pharmacy',
  prescriptions: 'nav.prescriptions',
  documents: 'nav.ged',
  messages: 'nav.messages',
  practitioners: 'nav.practitioners',
  locations: 'nav.locations',
  profile: 'user.profile',
  admin: 'nav.admin',
  settings: 'nav.settings',
  users: 'nav.users',
  roles: 'nav.roles',
  jobs: 'nav.jobs',
  audit: 'nav.audit',
  catalog: 'nav.catalog',
  database: 'nav.database',
  sources: 'nav.sources',
  system: 'nav.system',
  themes: 'nav.themes',
  translations: 'nav.translations',
  interventionTypes: 'nav.interventionTypes',
  categories: 'nav.categories',
  new: 'crumb.new',
  dossiers: 'crumb.careRecords',
};

/** Codes de modules de fiches (records/[module]) → clé i18n existante. */
const MODULES: Record<string, string> = {
  CON: 'nav.consultations',
  LAB: 'nav.lab',
  RAD: 'nav.radio',
  CAR: 'nav.cardio',
  ANA: 'nav.anatpath',
  GYP: 'nav.gynped',
  SOI: 'nav.care',
  CER: 'nav.certificates',
  DIA: 'nav.diagnosis',
  SUR: 'nav.surgery',
  REE: 'nav.reedu',
  SPE: 'nav.specialties',
};

/** Segments purement techniques (jamais affichés tels quels). */
const HIDDEN = new Set(['(app)']);

/** Un segment est un identifiant s'il est numérique ou ressemble à une route dynamique. */
function isIdSegment(seg: string): boolean {
  return /^\d+$/.test(seg) || seg.startsWith('[') || /^[A-Za-z]{2,4}-\d/.test(seg);
}

/**
 * Construit le fil d'Ariane depuis un chemin.
 * @param labelFor résout un segment en libellé traduit (fourni par le hook i18n).
 */
export function buildCrumbs(pathname: string, labelFor: (key: string, fallback: string) => string): Crumb[] {
  const segs = pathname.split('/').filter((s) => s && !HIDDEN.has(s));
  const out: Crumb[] = [];
  let acc = '';
  let prevModule: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    acc += `/${seg}`;
    const isLast = i === segs.length - 1;
    // records/[module] : le code du module devient le libellé (CON → Consultations).
    if (prevModule === 'records' && MODULES[seg]) {
      out.push({ href: acc, label: labelFor(MODULES[seg]!, seg), current: isLast });
    } else if (seg === 'dossiers') {
      out.push({ href: acc, label: labelFor('crumb.careRecords', seg), current: isLast });
    } else if (isIdSegment(seg)) {
      // Identifiant : libellé de contexte quand on le connaît, sinon la valeur brute en mono.
      const ctx = prevModule === 'patients' ? 'crumb.patientFile' : prevModule === 'dossiers' ? 'crumb.careRecord' : prevModule === 'prescriptions' ? 'crumb.prescription' : null;
      out.push({ href: acc, label: ctx ? labelFor(ctx, seg) : seg, isId: !ctx, current: isLast });
    } else if (STATIC[seg]) {
      out.push({ href: acc, label: labelFor(STATIC[seg]!, seg), current: isLast });
    } else {
      out.push({ href: acc, label: seg, current: isLast });
    }
    prevModule = seg;
  }
  return out;
}

export function Breadcrumb({ className }: { className?: string }): React.ReactElement | null {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useT('common');

  const crumbs = useMemo(
    () => buildCrumbs(pathname ?? '/', (key, fallback) => {
      const v = t(key);
      // t() renvoie la clé brute si elle est absente : on retombe alors sur le segment.
      return v === key ? fallback : v;
    }),
    [pathname, t],
  );

  // Rien à afficher sur le tableau de bord (racine de l'application) : pas de « retour » possible.
  if (crumbs.length === 0 || !pathname || pathname === '/' || pathname === '/dashboard') return null;

  // Cible du retour : le niveau parent du fil (ou le tableau de bord pour une page racine).
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2]! : null;
  const backHref = parent?.href ?? '/dashboard';
  const backLabel = parent ? parent.label : t('nav.dashboard');

  const goBack = (): void => {
    // Historique disponible et cohérent → back() (conserve l'état de la liste précédente :
    // filtres, page, mode d'affichage). Sinon on suit le fil d'Ariane.
    if (typeof window !== 'undefined' && window.history.length > 1 && parent) router.back();
    else router.push(backHref);
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {/* Bouton retour mis en évidence : libellé + cible, pas seulement une icône. */}
      <button
        type="button"
        onClick={goBack}
        className="btn-back btn btn-sm shrink-0 gap-1.5"
        title={t('ui.backTo', { path: backLabel })}
        aria-label={t('ui.backTo', { path: backLabel })}
      >
        <ArrowLeft size={15} className="rtl:rotate-180" />
        <span className="max-w-[9.5rem] truncate">{t('ui.back')}</span>
        <span className="hidden max-w-[11rem] truncate border-s border-[rgb(var(--c-primary)/0.3)] ps-1.5 text-[11.5px] font-medium opacity-80 sm:inline">
          {backLabel}
        </span>
      </button>

      {/* Chemin complet — le dernier élément n'est pas un lien (page courante). */}
      <nav aria-label={t('crumb.youAreHere')} className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        <Link href="/dashboard" className="crumb-link shrink-0" title={t('nav.dashboard')} aria-label={t('nav.dashboard')}>
          <Home size={13} />
        </Link>
        {crumbs.map((c, i) => (
          <React.Fragment key={`${c.href}-${i}`}>
            <ChevronRight size={12} className="crumb-sep shrink-0 rtl:rotate-180" aria-hidden="true" />
            {c.current || i === crumbs.length - 1 ? (
              <span className="crumb-current min-w-0 truncate" aria-current="page">
                {c.isId ? <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{c.label}</span> : c.label}
              </span>
            ) : (
              <Link href={c.href} className="crumb-link min-w-0 max-w-[13rem] truncate">
                {c.isId ? <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{c.label}</span> : c.label}
              </Link>
            )}
          </React.Fragment>
        ))}
      </nav>
    </div>
  );
}
