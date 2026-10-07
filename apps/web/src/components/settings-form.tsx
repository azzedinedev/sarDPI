'use client';
/**
 * RENDU DES FORMULAIRES DE PARAMÈTRES PILOTÉS PAR SPÉCIFICATION (voir lib/settings-fields.ts).
 * ------------------------------------------------------------------------------------------------
 * Deux briques, volontairement génériques — un seul code pour neuf modules :
 *
 *   <SettingsForm>       champs scalaires regroupés (texte, nombre, interrupteur, liste déroulante,
 *                        couleur, horaire, mot de passe, libellé multilingue) ;
 *   <CollectionEditor>   CRUD des listes du module : tableau lisible, tiroir de saisie, ajout,
 *                        modification, réordonnancement, suppression. Aucune ligne n'est perdue :
 *                        tout passe par `onChange` (l'objet de section vit dans la page, qui gère
 *                        l'état « modifié » et l'enregistrement).
 *
 * VALIDATION : les messages affichés proviennent du schéma partagé (`issuesByPath`) — les mêmes
 * contraintes que l'API. Le tiroir valide la ligne EN COURS DE SAISIE (brouillon inclus dans la
 * section le temps du contrôle), les erreurs s'affichent champ par champ, et la barre
 * d'enregistrement refuse une section invalide.
 */
import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Field, Input, Select, Switch } from '@/components/ui';
import { Drawer } from '@/components/dialogs';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  SECTION_FORMS,
  collectionAdd,
  collectionMove,
  collectionRemove,
  collectionUpdate,
  duplicateKeyIndex,
  fieldParse,
  fieldValue,
  getPath,
  itemTitle,
  issuesByPath,
  issuesVarsByPath,
  setPath,
  type CollectionSpec,
  type FieldSpec,
} from '@/lib/settings-fields';

/** Langues éditées pour les libellés multilingues — ordre figé, aligné sur le générateur de locales. */
const LANGS = ['fr', 'ar', 'es', 'en'] as const;

/** Codes de message connus : traduits ; toute autre valeur vient du serveur et s'affiche telle quelle. */
const MESSAGE_CODES = new Set([
  'tooSmall',
  'tooBig',
  'required',
  'enum',
  'pattern',
  'invalid',
  'jsonSyntax',
  'duplicateKey',
  'gedPrefix',
  'gedPath',
  'stepKey',
  'kindKey',
  'vaccineKey',
  'time',
  'captchaSitekey',
  'captchaSecret',
]);

/** Traduit un code d'erreur (sinon renvoie le message brut fourni par l'API). */
function useErrorText(): (code: string | undefined, vars?: Record<string, string | number>) => string | undefined {
  const { t } = useT('settings');
  return (code, vars) => {
    if (!code) return undefined;
    return MESSAGE_CODES.has(code) ? t(`settings.validation.${code}`, vars) : code;
  };
}

/* ------------------------------------------------------------------ champs scalaires */

function TextField({ spec, value, onChange, error }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; error?: string }): React.ReactElement {
  const { t } = useT('settings');
  const common = { value: value === undefined || value === null ? '' : String(value), onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(fieldParse(spec, e.target.value)), placeholder: spec.placeholder };
  if (spec.kind === 'i18n') {
    const map = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
    return (
      <Field label={t(spec.labelKey)} hint={spec.hintKey ? t(spec.hintKey) : undefined} error={error}>
        <div className="grid gap-2 sm:grid-cols-2">
          {LANGS.map((l) => (
            <div key={l} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-[11px] font-bold uppercase text-[rgb(var(--c-muted))]">{l}</span>
              <Input dir={l === 'ar' ? 'rtl' : 'ltr'} value={map[l] ?? ''} onChange={(e) => onChange({ ...map, [l]: e.target.value })} aria-label={`${t(spec.labelKey)} (${l})`} />
            </div>
          ))}
        </div>
      </Field>
    );
  }
  return (
    <Field label={t(spec.labelKey)} hint={spec.hintKey ? t(spec.hintKey) : undefined} error={error}>
      <Input
        {...common}
        type={spec.kind === 'number' ? 'number' : spec.kind === 'color' ? 'color' : spec.kind === 'time' ? 'time' : spec.kind === 'password' ? 'password' : 'text'}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        autoComplete={spec.kind === 'password' ? 'new-password' : undefined}
        className={cn(spec.kind === 'color' && 'h-10 w-full max-w-[72px] p-1', spec.kind === 'numbers' && 'font-mono')}
      />
    </Field>
  );
}

function SwitchField({ spec, value, onChange, error }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; error?: string }): React.ReactElement {
  const { t } = useT('settings');
  const on = value === true || value === 1 || value === '1' || value === 'true';
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-[rgb(var(--c-line)/0.7)] px-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{t(spec.labelKey)}</span>
        {spec.hintKey ? <span className="block text-[11.5px] text-[rgb(var(--c-muted))]">{t(spec.hintKey)}</span> : null}
        {error ? <span className="block text-[11.5px] font-semibold text-[rgb(var(--c-coral))]">{error}</span> : null}
      </span>
      <Switch checked={on} onChange={(v) => onChange(v)} />
    </div>
  );
}

function SelectField({ spec, value, onChange, error }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; error?: string }): React.ReactElement {
  const { t } = useT('settings');
  const options = (spec.options ?? []).map((o) => ({ value: o.value, label: t(o.labelKey) }));
  return (
    <Field label={t(spec.labelKey)} hint={spec.hintKey ? t(spec.hintKey) : undefined} error={error}>
      <Select value={String(value ?? '')} options={options} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Un champ, quel que soit son type — c'est ce point unique qui rend les modules interchangeables. */
export function SettingsField({ spec, item, onChange, error }: { spec: FieldSpec; item: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; error?: string }): React.ReactElement {
  const value = fieldValue(item, spec);
  const change = (v: unknown): void => onChange({ [spec.path]: v });
  if (spec.kind === 'switch') return <SwitchField spec={spec} value={value} onChange={change} error={error} />;
  if (spec.kind === 'select') return <SelectField spec={spec} value={value} onChange={change} error={error} />;
  return <TextField spec={spec} value={value} onChange={change} error={error} />;
}

/** Grille de champs : 1 colonne (mobile) → 2 (tablette) → 3 (poste large). */
function FieldGrid({ fields, item, onPatch, errors, prefix = '' }: { fields: FieldSpec[]; item: Record<string, unknown>; onPatch: (patch: Record<string, unknown>) => void; errors: Record<string, string>; prefix?: string }): React.ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map((f) => (
        <SettingsField key={f.path} spec={f} item={item} onChange={onPatch} error={errors[`${prefix}${f.path}`]} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ listes éditables (CRUD) */

function CollectionEditor({
  spec,
  section,
  data,
  items,
  onChange,
  errors,
  errorText,
}: {
  spec: CollectionSpec;
  section: string;
  data: Record<string, unknown>;
  items: Record<string, unknown>[];
  onChange: (items: Record<string, unknown>[]) => void;
  errors: Record<string, string>;
  errorText: (code: string | undefined, vars?: Record<string, string | number>) => string | undefined;
}): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const [drawer, setDrawer] = useState<{ index: number; isNew: boolean } | null>(null);

  const addable = spec.addable !== false;
  const removable = spec.removable !== false;
  const atMax = Boolean(spec.max && items.length >= spec.max);

  /**
   * Erreurs rattachées à une entrée. Le serveur renvoie des chemins pointés (« types.2.prefix »)
   * tandis qu'un message global de section (clé « _ » ou champ hors liste) n'appartient à aucune
   * ligne : il est donc traité à part par la page, et cette fonction ne remonte que le local.
   */
  const rowErrors = (i: number): string[] => Object.keys(errors).filter((k) => k.startsWith(`${spec.path}.${i}.`));

  const fieldsFor = (i: number): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(errors)) {
      const m = new RegExp(`^${spec.path}\\.${i}\\.(.+)$`).exec(k);
      if (m) out[m[1]!] = v;
    }
    return out;
  };

  /**
   * « Ajouter » crée IMMÉDIATEMENT la ligne (gabarit du module) puis ouvre le tiroir dessus : l'index
   * du brouillon reste ainsi stable pendant toute la saisie. Le construire à l'ouverture mais ne
   * l'insérer qu'à la première frappe ferait glisser la position à chaque caractère (la liste
   * s'allonge), et le tiroir éditerait une ligne différente de celle affichée.
   */
  const openNew = (): void => {
    if (atMax) return;
    const next = collectionAdd(items, spec);
    onChange(next);
    setDrawer({ index: next.length - 1, isNew: true });
  };
  const openEdit = (i: number): void => setDrawer({ index: i, isNew: false });

  const draftIndex = drawer ? drawer.index : -1;
  /**
   * Erreurs de la ligne en saisie : le brouillon étant déjà DANS la section (à son index), il suffit
   * de rejouer la validation de la section et de ne garder que les chemins de cette ligne.
   */
  const draftErrors = useMemo(() => (drawer ? fieldErrorsFrom(section, data, `${spec.path}.${draftIndex}.`) : {}), [drawer, section, data, spec.path, draftIndex]);
  const draftErrorVars = useMemo(() => (drawer ? varErrorsFrom(section, data, `${spec.path}.${draftIndex}.`) : {}), [drawer, section, data, spec.path, draftIndex]);

  const draft = drawer ? (items[draftIndex] ?? spec.template()) : {};
  const keyValue = String(getPath(draft, spec.keyField) ?? '');
  /**
   * Clé déjà utilisée par une AUTRE entrée : refusée (elle identifie la ligne dans les données).
   * La ligne en cours d'édition est exclue du contrôle — y compris une ligne neuve, déjà insérée
   * dans la liste à l'ouverture du tiroir : sans cette exclusion, la première frappe se signalerait
   * elle-même comme doublon et bloquerait la validation.
   */
  const duplicate = drawer ? duplicateKeyIndex(items, spec.keyField, keyValue, drawer.index) >= 0 : false;

  const patchDraft = (patch: Record<string, unknown>): void => {
    if (!drawer) return;
    onChange(collectionUpdate(items, drawer.index, patch, spec));
  };

  const commit = (): void => setDrawer(null);

  const cancel = (): void => {
    // « Ajouter » a inséré la ligne : si rien n'a été saisi, on la retire (un début de saisie, même
    // sans clé, est conservé — la validation signalera la clé manquante plutôt que de perdre le travail).
    if (drawer?.isNew && isBlankRow(draft, spec)) onChange(collectionRemove(items, draftIndex, spec));
    setDrawer(null);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{t(spec.labelKey)}</h3>
        <span className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.crud.count', { n: items.length })}</span>
        {addable ? (
          <Button size="sm" variant="primary" className="ms-auto" onClick={openNew} disabled={atMax} title={atMax ? t('settings.crud.maxReached') : undefined}>
            <Plus size={13} /> {t('settings.crud.add')}
          </Button>
        ) : null}
      </div>
      {spec.hintKey ? <p className="-mt-1 text-[12px] text-[rgb(var(--c-muted))]">{t(spec.hintKey)}</p> : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[rgb(var(--c-line))] px-3 py-4 text-center text-[12.5px] text-[rgb(var(--c-muted))]">{t('settings.crud.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[rgb(var(--c-line))]">
          <table className="dt-table">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>{t('settings.field.key')}</th>
                <th>{t('settings.field.label')}</th>
                {spec.itemFields.some((f) => f.path === 'color') ? <th className="w-16">{t('settings.field.color')}</th> : null}
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const errs = rowErrors(i);
                return (
                  <tr key={`${String(getPath(it, spec.keyField) ?? '')}-${i}`} className={cn(errs.length > 0 && 'bg-[rgb(var(--c-coral-soft)/0.4)]')}>
                    <td className="text-[12px] text-[rgb(var(--c-muted))]">{i + 1}</td>
                    <td dir="ltr" className="font-mono text-[12.5px] font-bold">
                      {String(getPath(it, spec.keyField) ?? '—')}
                    </td>
                    <td className="text-[12.5px]">
                      {itemTitle(it, spec.keyField) || <span className="text-[rgb(var(--c-muted))]">{t('settings.crud.untitled')}</span>}
                      {errs.length ? (
                        <span className="ms-2 align-middle">
                          <span title={errs.map((k) => errorText(errors[k]) ?? k).join(' · ')} className="badge bg-[rgb(var(--c-coral-soft))] text-[rgb(var(--c-coral))]">
                            {t('settings.crud.invalid')}
                          </span>
                        </span>
                      ) : null}
                    </td>
                    {spec.itemFields.some((f) => f.path === 'color') ? (
                      <td>
                        <span className="inline-block h-4 w-6 rounded border border-[rgb(var(--c-line))]" style={{ background: String(getPath(it, 'color') ?? 'transparent') }} />
                      </td>
                    ) : null}
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={t('settings.crud.moveUp')} disabled={i === 0} onClick={() => onChange(collectionMove(items, i, -1, spec))}>
                          <ArrowUp size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={t('settings.crud.moveDown')} disabled={i === items.length - 1} onClick={() => onChange(collectionMove(items, i, 1, spec))}>
                          <ArrowDown size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={tc('edit')} onClick={() => openEdit(i)}>
                          <Pencil size={13} />
                        </Button>
                        {removable ? (
                          <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7 text-[rgb(var(--c-coral))]" title={tc('delete')} onClick={() => onChange(collectionRemove(items, i, spec))}>
                            <Trash2 size={13} />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={drawer !== null}
        onClose={cancel}
        title={drawer?.isNew ? t('settings.crud.newTitle', { item: t(spec.labelKey) }) : t('settings.crud.editTitle', { item: t(spec.labelKey) })}
        subtitle={keyValue ? `${t('settings.field.key')} : ${keyValue}` : t(spec.hintKey ?? spec.labelKey)}
        footer={
          <>
            <Button onClick={cancel}>{tc('cancel')}</Button>
            {/* la clé reste verrouillée sur une ligne existante : elle référence des données (RDV, codes) */}
            <Button variant="primary" onClick={commit} disabled={duplicate}>
              <Check size={14} /> {tc('save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {duplicate ? <p className="rounded-xl bg-[rgb(var(--c-coral-soft))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--c-coral))]">{t('settings.validation.duplicateKey')}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {spec.itemFields.map((f) => {
              const locked = Boolean(f.lockedOnExisting && !drawer?.isNew && f.path === spec.keyField);
              const field = locked ? { ...f, hintKey: 'settings.crud.keyLocked' } : f;
              return (
                <div key={f.path} className={cn(f.kind === 'i18n' && 'sm:col-span-2')}>
                  {locked ? (
                    <Field label={t(f.labelKey)} hint={t('settings.crud.keyLocked')}>
                      <Input value={keyValue} disabled dir="ltr" className="font-mono" />
                    </Field>
                  ) : (
                    <SettingsField
                      spec={field}
                      item={draft}
                      onChange={patchDraft}
                      error={errorText(draftErrors[f.path], draftErrorVars[f.path])}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Drawer>
    </section>
  );
}

/**
 * Ligne encore vierge ? (ajout abandonné avant toute saisie)
 * Seuls les champs qui PORTENT un contenu comptent : couleur, durée, interrupteurs et listes
 * déroulantes ont toujours une valeur par défaut — sans quoi toute ligne paraîtrait « remplie ».
 */
export function isBlankRow(item: Record<string, unknown>, spec: CollectionSpec): boolean {
  const contentKinds = new Set(['text', 'password', 'i18n', 'numbers']);
  return spec.itemFields
    .filter((f) => contentKinds.has(f.kind))
    .every((f) => {
      const v = getPath(item, f.path);
      if (f.kind === 'i18n') return !v || Object.values(v as Record<string, string>).every((x) => !String(x ?? '').trim());
      if (f.kind === 'numbers') return !Array.isArray(v) || v.length === 0;
      return v === undefined || v === null || String(v).trim() === '';
    });
}

/* Erreurs/vars d'un brouillon : mêmes règles que la section entière, chemins préfixés. */
function fieldErrorsFrom(section: string, data: unknown, prefix: string): Record<string, string> {
  const all = issuesByPath(section, data);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}
function varErrorsFrom(section: string, data: unknown, prefix: string): Record<string, Record<string, string | number>> {
  const all = issuesVarsByPath(section, data);
  const out: Record<string, Record<string, string | number>> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/* ------------------------------------------------------------------ formulaire complet */

export function hasFormSpec(section: string): boolean {
  return Boolean(SECTION_FORMS[section]);
}

export function SettingsForm({ section, data, onChange, errors }: { section: string; data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void; errors: Record<string, string> }): React.ReactElement | null {
  const { t } = useT('settings');
  const errorText = useErrorText();
  const spec = SECTION_FORMS[section];
  if (!spec) return null;

  /**
   * Les convertisseurs renvoient `undefined` quand un champ numérique est vidé : la clé est écrite
   * telle quelle (et non supprimée) pour que le schéma signale « champ requis » au lieu de laisser
   * un défaut silencieux reprendre la main.
   */
  const patch = (p: Record<string, unknown>): void => {
    let next = data;
    for (const [k, v] of Object.entries(p)) next = setPath(next, k, v);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {spec.groups.map((g, gi) => (
        <section key={g.titleKey ?? gi} className="flex flex-col gap-3">
          {g.titleKey ? <h3 className="text-[11.5px] font-bold uppercase tracking-widest text-[rgb(var(--c-muted))]">{t(g.titleKey)}</h3> : null}
          {g.hintKey ? <p className="-mt-1.5 text-[12px] text-[rgb(var(--c-muted))]">{t(g.hintKey)}</p> : null}
          <FieldGrid fields={g.fields} item={data} onPatch={patch} errors={errors} />
        </section>
      ))}
      {spec.collections.map((c) => {
        const items = (getPath(data, c.path) as Record<string, unknown>[] | undefined) ?? [];
        return <CollectionEditor key={c.path} spec={c} section={section} data={data} items={items} errors={errors} errorText={errorText} onChange={(next) => onChange(setPath(data, c.path, next))} />;
      })}
    </div>
  );
}
