'use client';
/**
 * `CrudModule` — composant métier générique utilisé par TOUTES les écrans de liste (patients,
 * praticiens, catégories d'interventions, GED, pharmacie, admin…). Fournit :
 * 3 modes de vue (lignes / cartes / tableau), recherche, constructeur de filtres avancés +
 * filtres enregistrés, tri + PAGINATION SERVEUR, sélection multiple + actions groupées,
 * export CSV/Excel/PDF (via impression), création/édition dans un tiroir (zod), aperçu détail,
 * archivage/suppression logique avec confirmation, animations Framer Motion (désactivables).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Archive, ArrowLeft, Boxes, ChevronLeft, ChevronRight, Columns3, Download, Eye, LayoutGrid, MoreVertical, Pencil, Plus, RotateCcw, Rows3, Search, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT, useI18n } from '@/lib/i18n';
import { Badge, Button, Checkbox, EmptyState, Input, Skeleton, Switch } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { BizCode } from '@/components/biz-code';
import { PopMenu, usePop } from '@/components/popover';
import { CrudForm } from './form';
import { FilterBuilder } from './filters';
import type { CrudProps, RowData } from './types';
import type { FilterGroup } from '@sardpi/shared';

const EMPTY_GROUP: FilterGroup = { combinator: 'AND', items: [] };

export function CrudModule(props: CrudProps): React.ReactElement {
  const { resource, columns, fields = [], schema, extraQuery, softDelete = true, rowHref, detail } = props;
  const router = useRouter();
  const toast = useToast();
  const { t } = useT('common');
  const { t: te } = useT('errors');
  const i18n = useI18n();
  const qc = useQueryClient();
  const reduce = useReducedMotion();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState(props.initialQ ?? '');
  const [qDeb, setQDeb] = useState('');
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [sort, setSort] = useState<SortingState>(props.defaultSort ? [props.defaultSort] : []);
  const [filters, setFilters] = useState<FilterGroup>(EMPTY_GROUP);
  const filterPop = usePop();
  const filterRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'table' | 'rows' | 'cards'>(() => (localStorage.getItem(`sardpi:view:${resource}`) as 'table' | 'rows' | 'cards') || 'table');
  const [vis, setVis] = useState<VisibilityState>(() => Object.fromEntries(columns.filter((c) => c.hideByDefault).map((c) => [c.key, false])));
  const visPop = usePop();
  const visRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit' | 'view'; row?: RowData } | null>(null);
  const [confirm, setConfirm] = useState<{ action: () => Promise<void>; label: string; danger?: boolean } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQDeb(q);
      setPage(1);
    }, 260);
  }, [q]);

  useEffect(() => {
    localStorage.setItem(`sardpi:view:${resource}`, view);
  }, [resource, view]);

  useEffect(() => setSelected([]), [page, qDeb, scope, filters, JSON.stringify(extraQuery ?? {})]);

  const sortState = sort[0] ?? (props.defaultSort ? { id: props.defaultSort.id, desc: props.defaultSort.desc } : { id: undefined as unknown as string, desc: false });

  const query = useQuery({
    queryKey: ['list', resource, { page, pageSize, q: qDeb, scope, sortBy: sortState.id, sortDir: sortState.desc ? 'desc' : 'asc', filters: filters.items.length ? JSON.stringify(filters) : undefined, ...extraQuery }],
    queryFn: () =>
      api.get<{ rows: RowData[]; total: number; page: number; pageSize: number }>(`/${resource}`, {
        page,
        pageSize,
        q: qDeb || undefined,
        scope: props.scopeSelect ? scope : undefined,
        sortBy: sortState.id,
        sortDir: sortState.desc ? 'desc' : 'asc',
        filters: filters.items.length ? JSON.stringify(filters) : undefined,
        ...extraQuery,
      }),
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const total = query.data?.total ?? 0;

  const refetchAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['list', resource] });
    void qc.invalidateQueries({ queryKey: [resource] });
    props.onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, resource]);

  const save = useMutation({
    mutationFn: async ({ mode, values, row }: { mode: 'create' | 'edit'; values: Record<string, unknown>; row?: RowData }) => {
      const payload = mode === 'create' ? (props.transformCreate?.(values) ?? values) : (props.transformUpdate?.(values, row as RowData) ?? values);
      if (mode === 'create') return await api.post<{ id: number; row: RowData }>(`/${resource}`, payload);
      return await api.put<{ row: RowData }>(`/${resource}/${row?.id}`, payload);
    },
    onSuccess: (res, vars) => {
      toast.success(t('saved'));
      setDrawer(null);
      refetchAll();
      if (vars.mode === 'create' && 'row' in res && res.row) props.onCreated?.(res.row as RowData);
    },
    onError: (e: unknown) => {
      const err = e as ApiError;
      if (err.details) {
        const keys = Object.keys(err.details);
        toast.error(`${te(err.code)} — ${keys.join(', ')}`);
      } else toast.error(te(err.code ?? 'errors.network'));
    },
  });

  const del = useMutation({
    mutationFn: (row: RowData) => api.del(`/${resource}/${row.id}`),
    onSuccess: () => {
      toast.success(softDelete ? t('archived') : t('deleted'));
      refetchAll();
    },
  });

  const act = useMutation({
    mutationFn: async ({ row, action }: { row: RowData; action: 'archive' | 'restore' | 'toggle-active' }) => api.post(`/${resource}/${row.id}/${action}`, {}),
    onSuccess: () => {
      toast.success(t('saved'));
      refetchAll();
    },
  });

  const bulk = useMutation({
    mutationFn: async ({ action, ids }: { action: string; ids: number[] }) => {
      if (props.onBulk) return void (await props.onBulk(action, ids));
      return await api.post(`/${resource}/bulk`, { action, ids });
    },
    onSuccess: () => {
      toast.success(t('saved'));
      setSelected([]);
      refetchAll();
    },
    onError: (e: unknown) => toast.error(te((e as ApiError).code ?? 'errors.network')),
  });

  const tctx = useMemo(() => ({ t, lang: i18n.lang, dir: i18n.dir }), [t, i18n.lang, i18n.dir]);

  const tableCols = useMemo<ColumnDef<RowData>[]>(() => {
    const base: ColumnDef<RowData>[] = [
      {
        id: '__select',
        size: 34,
        header: ({ table }) => (
          <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-primary))]" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} aria-label="tout" />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="h-4 w-4 accent-[rgb(var(--c-primary))]"
            checked={selected.includes(row.original.id)}
            onChange={() => setSelected((s) => (s.includes(row.original.id) ? s.filter((x) => x !== row.original.id) : [...s, row.original.id]))}
            aria-label="ligne"
          />
        ),
      },
      ...columns.map((c) => ({
        id: c.key,
        accessorKey: c.key,
        enableSorting: c.sortable !== false,
        size: c.width ? parseInt(c.width, 10) : undefined,
        header: () => <span>{c.label}</span>,
        cell: ({ row }: { row: { original: RowData } }) => (c.render ? c.render(row.original, { t, lang: tctx.lang, dir: tctx.dir }) : formatCell(row.original[c.key])),
      })),
      {
        id: '__actions',
        size: 40,
        enableSorting: false,
        header: () => null,
        cell: ({ row }) => <RowActions row={row.original} {...{ props, setDrawer, setConfirm, t, softDelete, detail, router, act }} />,
      },
    ];
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, selected, t, tctx.lang, tctx.dir]);

  const table = useReactTable({
    data: rows,
    columns: tableCols,
    state: { sorting: sort, columnVisibility: vis },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sort) : updater;
      setSort(next);
      setPage(1);
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });

  const exportRows = async (fmt: 'csv' | 'xls' | 'pdf'): Promise<void> => {
    if (fmt === 'pdf') {
      printTable();
      return;
    }
    try {
      const qs = new URLSearchParams({ scope, ...(qDeb ? { q: qDeb } : {}), ...(filters.items.length ? { filters: JSON.stringify(filters) } : {}), ...Object.fromEntries(Object.entries(extraQuery ?? {}).map(([k, v]) => [k, String(v)])) });
      const csv = await api.get<string>(`/${resource}/export?${qs.toString()}`);
      const blob = new Blob([fmt === 'xls' ? `\uFEFF<table><tr><td>${csv.replace(/\r?\n/g, '</td></tr><tr><td>').replace(/;/g, '</td><td>')}</td></tr></table>` : csv], { type: fmt === 'xls' ? 'application/vnd.ms-excel' : 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${resource}-${new Date().toISOString().slice(0, 10)}.${fmt}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(t('export.done'));
    } catch {
      toast.error(te('errors.network'));
    }
  };

  const printTable = (): void => {
    const cols = columns.filter((c) => vis[c.key] !== false);
    const html = `<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${typeof props.title === 'string' ? props.title : resource}</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:16px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:start}th{background:#eee}.code{font-family:monospace;direction:ltr;unicode-bidi:isolate}</style>
      </head><body><h2>${typeof props.title === 'string' ? props.title : resource} — ${new Date().toLocaleString()}</h2><table><thead><tr>${cols
        .map((c) => `<th>${typeof c.label === 'string' ? c.label : c.key}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${cols.map((c) => {
          const v = r[c.key];
          const txt = c.key === 'code' ? `<span class="code">${escapeHtml(String(v ?? ''))}</span>` : escapeHtml(fmtVal(v));
          return `<td>${txt}</td>`;
        }).join('')}</tr>`)
        .join('')}</tbody></table><script>window.onload=()=>{window.print()}</script></body></html>`;
    const w = window.open('', '_blank', 'width=1000,height=760');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const canCreate = props.canCreate ?? Boolean(fields.length);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="flex flex-col gap-3">
      {/* En-tête */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight">{props.title}</h1>
          {props.subtitle ? <p className="mt-0.5 text-[13.5px] text-[rgb(var(--c-muted))]">{props.subtitle}</p> : null}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {props.toolbarExtra}
          {canCreate ? (
            <Button variant="primary" onClick={() => setDrawer({ mode: 'create' })} className="shadow-[var(--shadow-glow)]">
              <Plus size={16} /> {props.createLabel ?? t('new')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Barre d'outils */}
      <div className="glass-card flex flex-wrap items-center gap-2 !p-2">
        {props.search !== false ? (
          <div className="relative min-w-[160px] max-w-[320px] flex-1">
            <Search size={16} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-2.5 rtl:right-2.5" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={props.searchPlaceholder ?? t('search')} className="!min-h-10 !py-1 !text-[14px] ps-9" />
            {q ? (
              <button className="absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:right-2 rtl:left-2" onClick={() => setQ('')} aria-label={t('clear')}>
                <X size={13} />
              </button>
            ) : null}
          </div>
        ) : null}

        {props.scopeSelect ? (
          <div className="flex overflow-hidden rounded-[8px] border border-[rgb(var(--c-line))] text-[13px] font-semibold">
            {(['active', 'archived', 'all'] as const).map((sc) => (
              <button key={sc} onClick={() => { setScope(sc); setPage(1); }} className={cn('min-h-10 px-3', scope === sc ? 'bg-[rgb(var(--c-primary))] text-white' : 'text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface-2))]')}>
                {t(`scope.${sc}`)}
              </button>
            ))}
          </div>
        ) : null}

        {props.filterFields?.length ? (
          <div className="relative" ref={filterRef}>
            <Button size="sm" variant={filters.items.length ? 'primary' : 'ghost'} onClick={filterPop.toggle}>
              <SlidersHorizontal size={15} /> {filters.items.length ? `${filters.items.length}` : t('filters.title')}
            </Button>
            <PopMenu open={filterPop.open} onClose={filterPop.close} anchor={filterRef} className="w-[560px] max-w-[92vw] !p-3">
              <FilterBuilder resource={resource} fields={props.filterFields} value={filters} onChange={(g) => { setFilters(g); setPage(1); }} />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" onClick={filterPop.close}>{t('apply')}</Button>
              </div>
            </PopMenu>
          </div>
        ) : null}

        <div className="relative" ref={visRef}>
          <Button size="sm" variant="ghost" onClick={visPop.toggle}>
            <Columns3 size={15} /> <span className="max-md:hidden">{t('columns')}</span>
          </Button>
          <PopMenu open={visPop.open} onClose={visPop.close} anchor={visRef} className="max-h-[min(26rem,70vh)] w-64 overflow-y-auto !p-1.5">
            {columns.map((c) => (
              <div key={c.key} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[rgb(var(--c-surface-2))]">
                <span className="text-[13.5px] font-medium">{typeof c.label === 'string' ? c.label : c.key}</span>
                <Switch checked={vis[c.key] !== false} onChange={(on) => setVis((v) => ({ ...v, [c.key]: on }))} />
              </div>
            ))}
          </PopMenu>
        </div>

        {props.canExport !== false ? (
          <div className="flex overflow-hidden rounded-[8px] border border-[rgb(var(--c-line))]">
            {(['csv', 'xls', 'pdf'] as const).map((f) => (
              <button key={f} onClick={() => void exportRows(f)} className="min-h-10 px-2.5 text-[12.5px] font-bold uppercase text-[rgb(var(--c-muted))] transition-colors hover:bg-[rgb(var(--c-surface-2))]" title={`${t('export.to')} ${f}`}>
                <Download size={14} className="me-0.5 inline ltr:mr-1 rtl:ml-1" />
                {f}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ms-auto flex overflow-hidden rounded-[8px] border border-[rgb(var(--c-line))]">
          {(
            [
              ['table', Table2],
              ['rows', Rows3],
              ['cards', LayoutGrid],
            ] as const
          ).map(([v, Ic]) => (
            <button key={v} onClick={() => setView(v)} className={cn('min-h-10 px-3 transition-colors', view === v ? 'bg-[rgb(var(--c-primary)/0.14)] text-[rgb(var(--c-primary))]' : 'text-[rgb(var(--c-muted))] hover:bg-[rgb(var(--c-surface-2))]')} title={t(`view.${v}`)}>
              <Ic size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* Barre d'actions groupées */}
      <AnimatePresence>
        {selected.length ? (
          <motion.div initial={{ opacity: 0, y: reduce ? 0 : -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -8, height: 0 }} className="overflow-hidden">
            <div className="glass-card flex flex-wrap items-center gap-2 border-[rgb(var(--c-primary)/0.5)] !p-2">
              <Badge tone="info">{selected.length}</Badge>
              <span className="text-[12.5px] font-semibold">{t('selection')}</span>
              {(props.bulkActions ?? []).map((b) => (
                <Button key={b.key} size="sm" variant={b.danger ? 'danger' : 'ghost'} loading={bulk.isPending} onClick={() => setConfirm({ label: `${b.label} — ${selected.length}`, action: () => bulk.mutateAsync({ action: b.key, ids: selected }).then(() => undefined) })}>
                  {b.label}
                </Button>
              ))}
              {props.canArchive !== false && softDelete ? (
                <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => setConfirm({ label: `${t('archive')} — ${selected.length}`, action: async () => { await api.post(`/${resource}/bulk`, { action: 'archive', ids: selected }); refetchAll(); setSelected([]); } })}>
                  <Archive size={13} /> {t('archive')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t('clear')}</Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Corps : tableau */}
      {query.isLoading ? (
        <div className="glass-card flex flex-col gap-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card soft>
          <EmptyState icon={view === 'cards' ? Boxes : Search} title={t('list.empty')} hint={t('list.emptyHint')} action={canCreate ? <Button variant="primary" onClick={() => setDrawer({ mode: 'create' })}><Plus size={15} /> {props.createLabel ?? t('new')}</Button> : undefined} />
        </Card>
      ) : view === 'table' || view === 'rows' ? (
        <Card className="overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="dt-table">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={cn('cursor-pointer whitespace-nowrap text-start', h.column.id === '__select' && 'cursor-default w-8')}
                        style={{ width: view === 'rows' && h.column.id === '__actions' ? 'auto' : undefined }}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {{ asc: '▲', desc: '▼' }[h.column.getIsSorted() as string] ?? ''}
                        </span>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r, i) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: reduce ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: reduce ? 0 : Math.min(i, 12) * 0.012 }}
                    data-selected={selected.includes(r.original.id)}
                    className={cn('group', rowHref && 'cursor-pointer')}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button,input,a')) return;
                      if (rowHref) router.push(rowHref(r.original));
                      else if (detail || fields.length) setDrawer({ mode: detail ? 'view' : 'edit', row: r.original });
                    }}
                  >
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className={view === 'rows' && c.column.id === '__actions' ? 'text-end' : undefined}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
          {rows.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduce ? 0 : Math.min(i, 14) * 0.03, ease: [0.22, 1, 0.36, 1] }}>
              <Card className="list-card group relative flex h-full min-h-[128px] cursor-pointer flex-col gap-1.5" onClick={() => (rowHref ? router.push(rowHref(r)) : setDrawer({ mode: detail ? 'view' : 'edit', row: r }))}>
                <div className="absolute top-2.5 z-10 ltr:right-2.5 rtl:left-2.5" onClick={(e) => e.stopPropagation()}>
                  <RowActions row={r} {...{ props, setDrawer, setConfirm, t, softDelete, detail, router, act }} />
                </div>
                <Checkbox
                  className="absolute top-2 ltr:left-2.5 rtl:right-2.5 opacity-60"
                  checked={selected.includes(r.id)}
                  onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                />
                <div className="min-w-0 pe-6 ps-6">
                  <div className="truncate text-[15.5px] font-bold">{props.cardTitle ? props.cardTitle(r) : (r.name as string) ?? (r.fullName as string) ?? (r.code as string)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[rgb(var(--c-muted))]">
                    {props.cardSubtitle ? props.cardSubtitle(r) : r.code ? <BizCode code={r.code as string} /> : null}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 ps-6">
                  {props.cardBadges ? props.cardBadges(r) : columns.filter((c) => !c.hideByDefault && c.key !== 'code' && c.key !== 'name').slice(0, 3).map((c) => (
                    <Badge key={c.key}>{fmtVal(r[c.key]) || '—'}</Badge>
                  ))}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination serveur */}
      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="text-[rgb(var(--c-muted))]">
          {t('list.count')} : <b className="font-mono">{total}</b>
        </span>
        <div className="ms-auto flex items-center gap-1.5">
          <select className="field !min-h-9 w-auto !py-0.5 !text-[13px]" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>{n}/p.</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="prev">
            <ChevronLeft size={14} className="rtl:rotate-180" />
          </Button>
          <span className="min-w-[70px] text-center font-mono">
            {page} / {pageCount}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="next">
            <ChevronRight size={14} className="rtl:rotate-180" />
          </Button>
        </div>
      </div>

      {/* Tiroir formulaire / détail */}
      {fields.length ? (
        <CrudForm
          open={drawer?.mode === 'create' || drawer?.mode === 'edit'}
          onClose={() => setDrawer(null)}
          title={drawer?.mode === 'create' ? (props.createLabel ?? t('new')) : t('edit')}
          fields={fields.map((f) => ({ ...f, label: f.label }))}
          row={drawer?.mode === 'edit' ? drawer.row ?? null : null}
          schema={schema}
          busy={save.isPending}
          onSubmit={(values) => save.mutate({ mode: drawer?.mode as 'create' | 'edit', values, row: drawer?.row })}
        />
      ) : null}

      <Dialog open={Boolean(drawer?.mode === 'view' && drawer.row)} onClose={() => setDrawer(null)} title={<span className="flex items-center gap-2">{drawer?.row?.code ? <BizCode code={drawer.row.code as string} /> : null}</span>} wide>
        {drawer?.mode === 'view' && drawer.row ? (
          <div className="flex flex-col gap-3">
            {detail?.(drawer.row)}
            {props.canUpdate !== false && fields.length ? (
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={() => setDrawer({ mode: 'edit', row: drawer.row })}>
                  <Pencil size={13} /> {t('edit')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* Confirmation */}
      <Dialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={t('confirm.title')}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button
              variant={confirm?.danger === false ? 'primary' : 'danger'}
              onClick={async () => {
                try {
                  await confirm?.action();
                  setConfirm(null);
                } catch (e) {
                  toast.error(te((e as ApiError).code ?? 'errors.network'));
                }
              }}
            >
              {t('confirm.go')}
            </Button>
          </>
        }
      >
        <p className="text-[14.5px]">{confirm?.label}</p>
        <p className="mt-2 text-[13.5px] text-[rgb(var(--c-muted))]">{t('confirm.hint')}</p>
      </Dialog>
    </section>
  );
}

/* ------------------------------------------------------------------ actions ligne */
function RowActions({ row, props, setDrawer, setConfirm, t, softDelete, detail, router, act }: { row: RowData; props: CrudProps; setDrawer: (d: { mode: 'create' | 'edit' | 'view'; row?: RowData } | null) => void; setConfirm: (c: { action: () => Promise<void>; label: string } | null) => void; t: (k: string) => string; softDelete: boolean; detail?: (r: RowData) => React.ReactNode; router: ReturnType<typeof useRouter>; act: { mutate: (v: { row: RowData; action: 'archive' | 'restore' | 'toggle-active' }) => void } }): React.ReactElement {
  const pop = usePop();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="relative flex justify-end" ref={ref}>
      <div className="flex gap-0.5">
        {(props.canUpdate !== false || detail) && (props.canUpdate !== false || Boolean(detail)) ? (
          <Button
            size="sm"
            variant="ghost"
            className="btn-icon !min-h-8 !min-w-8 hover:opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
            onClick={() => setDrawer({ mode: detail ? 'view' : 'edit', row })}
            title={detail ? t('view') : t('edit')}
          >
            {detail ? <Eye size={15} /> : <Pencil size={15} />}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className={cn('btn-icon !min-h-8 !min-w-8', (props.rowMenu || props.canDelete !== false || props.canArchive !== false) && 'opacity-70')} onClick={() => pop.toggle()} title="…">
          <MoreVertical size={16} />
        </Button>
      </div>
      <PopMenu open={pop.open} onClose={pop.close} anchor={ref} className="w-52 !p-1.5">
              {props.canUpdate !== false && props.fields?.length ? (
                <MenuItem icon={Pencil} label={t('edit')} onClick={() => { pop.close(); setDrawer({ mode: 'edit', row }); }} />
              ) : null}
              {rowHrefGuard(props, row) ? (
                <MenuItem icon={ArrowLeft} label={t('open')} onClick={() => { pop.close(); router.push(rowHrefGuard(props, row) as string); }} />
              ) : null}
              {props.canArchive !== false && softDelete ? (
                <MenuItem
                  icon={row.archived_at ? RotateCcw : Archive}
                  label={row.archived_at ? t('restore') : t('archive')}
                  onClick={() => {
                    pop.close();
                    act.mutate({ row, action: row.archived_at ? 'restore' : 'archive' });
                  }}
                />
              ) : null}
              {props.canDelete !== false ? (
                <MenuItem
                  danger
                  icon={Trash2}
                  label={t('delete')}
                  onClick={() => {
                    pop.close();
                    setConfirm({ label: `${t('delete')} — ${(row.code as string) ?? row.id}`, action: async () => { await api.del(`/${props.resource}/${row.id}`); setDrawer(null); } });
                  }}
                />
              ) : null}
              {props.rowMenu?.(row, () => pop.close())}
      </PopMenu>
    </div>
  );
}

function rowHrefGuard(props: CrudProps, row: RowData): string | undefined {
  try {
    return props.rowHref?.(row);
  } catch {
    return undefined;
  }
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; danger?: boolean }): React.ReactElement {
  return (
    <button className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[14px] font-medium hover:bg-[rgb(var(--c-surface-2))]', danger && 'text-[rgb(var(--c-coral))]')} onClick={onClick}>
      <Icon size={15} /> {label}
    </button>
  );
}

/* ------------------------------------------------------------------ helpers */
export function Card({ children, className, soft, ...rest }: React.HTMLAttributes<HTMLDivElement> & { soft?: boolean }): React.ReactElement {
  return (
    <div className={cn(soft ? 'glass-soft' : 'glass-card', 'p-4', className)} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  );
}

export function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? '✓' : '—';
  return String(v);
}
function formatCell(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-[rgb(var(--c-muted)/0.5)]">—</span>;
  if (typeof v === 'object') return <span className="font-mono text-[12.5px]">{JSON.stringify(v)}</span>;
  if (typeof v === 'boolean') return v ? <Badge tone="ok">✓</Badge> : <Badge>—</Badge>;
  const s = String(v);
  if (/^(PAT|MED|DEN|PHR|INF|TLB|RDG|RDL|SEC|ADM|INT|LOC|RDV|MOV|MSG|DRG|CAS|LAB|PHA|DIA|CAR|RAD|CON|SPE|GYP|CHI|SOI|ANA|REE|CER|ORD|ANL|IMG|DOC|RPV|ADM|FIC)-[A-Z0-9-]+$/.test(s)) return <BizCode code={s} />;
  return <span title={s.length > 60 ? s : undefined} className="block max-w-[560px] truncate align-middle">{s}</span>;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
