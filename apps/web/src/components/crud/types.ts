'use client';
/** Types du module CRUD générique (configuration des pages métier). */
import type React from 'react';
import type { z } from 'zod';
import type { FilterGroup } from '@sardpi/shared';

export type FieldKind = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'time' | 'select' | 'multiselect' | 'autocomplete' | 'stringlist' | 'checkbox' | 'tel' | 'email' | 'password' | 'code' | 'json' | 'richtext' | 'custom';

export interface RenderInputCtx {
  value: unknown;
  setValue: (val: unknown) => void;
  setFieldValue: (field: string, val: unknown) => void;
  register: any; // ReturnType<typeof useForm>['register']
  row: RowData | null;
  formState: any;
  watch: (key: string) => unknown;
}

export interface FieldDef {
  key: string; // nom du champ côté API (camelCase)
  label?: React.ReactNode;
  kind?: FieldKind;
  required?: boolean;
  options?: { value: string | number; label: string }[];
  colSpan?: 1 | 2; // grille 2 colonnes
  /** regroupement visuel du formulaire (fieldset) — libellé de section ; consécutifs = même section */
  group?: React.ReactNode;
  hint?: string;
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
  placeholder?: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode; // vue lecture
  renderInput?: (ctx: RenderInputCtx) => React.ReactNode;
}

export interface ColDef {
  key: string;
  label: React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'start' | 'center' | 'end';
  render?: (row: RowData, ctx: RenderCtx) => React.ReactNode;
  hideByDefault?: boolean;
  filterKind?: FieldKind;
  filterOptions?: { value: string | number; label: string }[];
}

export type RowData = Record<string, unknown> & { id: number; code?: string | null };

export interface RenderCtx {
  t: (k: string) => string;
  lang: string;
  dir: 'rtl' | 'ltr';
}

export interface CrudProps {
  /** segment API (ex. « patients » → /api/v1/patients) */
  resource: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  columns: ColDef[];
  search?: boolean;
  searchPlaceholder?: string;
  defaultSort?: { id: string; desc: boolean };
  fields?: FieldDef[]; // formulaire créer/éditer (absent = pas de création)
  schema?: z.ZodTypeAny;
  createLabel?: string;
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  canArchive?: boolean;
  canExport?: boolean;
  softDelete?: boolean;
  scopeSelect?: boolean; // actif / archivés / tous
  extraQuery?: Record<string, string | number | undefined>; // scope patient, catégorie…
  initialQ?: string; // recherche préremplie (querystring global)
  /** deep-link : nom du paramètre querystring portant l'id à ouvrir dans le tiroir détail (défaut « open ») */
  openParam?: string;
  /** valeurs préremplies du formulaire de création (deep-link agenda/dossier) */
  createDefaults?: Record<string, unknown> | null;
  /** ouvrir directement le tiroir de création au montage (deep-link « ?new=1 ») */
  autoCreate?: boolean;
  transformCreate?: (values: Record<string, unknown>) => Record<string, unknown>;
  transformUpdate?: (values: Record<string, unknown>, row: RowData) => Record<string, unknown>;
  rowHref?: (row: RowData) => string;
  /** détails repliables sous la ligne (chevron ▸) — vue table uniquement */
  expand?: (row: RowData) => React.ReactNode; // clic ligne → page
  detail?: (row: RowData) => React.ReactNode; // aperçu dans le tiroir « voir »
  cardTitle?: (row: RowData) => React.ReactNode;
  cardSubtitle?: (row: RowData) => React.ReactNode;
  cardBadges?: (row: RowData) => React.ReactNode;
  rowMenu?: (row: RowData, close: () => void) => React.ReactNode;
  bulkActions?: { key: string; label: string; danger?: boolean }[];
  onBulk?: (action: string, ids: number[]) => Promise<void> | void;
  filterFields?: { field: string; label: string; kind?: FieldKind; options?: { value: string | number; label: string }[] }[];
  toolbarExtra?: React.ReactNode;
  onCreated?: (row: RowData) => void;
  onSaved?: () => void;
}

export interface SavedFilter {
  name: string;
  group: FilterGroup;
  sort?: { id: string; desc: boolean };
}
