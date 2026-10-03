'use client';
/**
 * Rôles & matrice de permissions — les rôles sont des données (créables en base) ; la matrice
 * module × action écrit « module.action » dans perms_json via PUT /roles/:id (cache invalidé serveur).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Grid3X3, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Checkbox, Tabs } from '@/components/ui';
import { CrudModule, fmtVal } from '@/components/crud';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { pickLabel } from '@sardpi/shared';

interface MatrixRole {
  id: number;
  key: string;
  name: Record<string, string>;
  system: boolean;
  perms: string[];
}
interface Matrix {
  modules: { key: string; label?: Record<string, string> }[] | string[];
  actions: { key: string; label?: Record<string, string> }[] | string[];
  roles: MatrixRole[];
}

export default function RolesPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const { lang } = useT('common');
  const has = useAuth((s) => s.has);
  const [matrixOpen, setMatrixOpen] = useState(false);
  return (
    <>
      <CrudModule
        resource="roles"
        title={t('admin.roles')}
        subtitle={t('roles.subtitle')}
        canCreate={has('roles', 'create')}
        canExport={false}
        defaultSort={{ id: 'role_key', desc: false }}
        toolbarExtra={
          <Button size="sm" variant="primary" onClick={() => setMatrixOpen(true)}>
            <Grid3X3 size={14} /> {t('roles.matrix')}
          </Button>
        }
        cardTitle={(r) => pickLabel(r.name_json as never, lang) || fmtVal(r.role_key)}
        cardBadges={(r) => <Badge tone="info">{fmtVal(r.role_key)}</Badge>}
        columns={[
          { key: 'role_key', label: tc('code'), sortable: true, width: '150px', render: (r) => <span dir="ltr" className="font-mono text-[12.5px] font-bold">{fmtVal(r.role_key)}</span> },
          { key: 'name', label: tc('title'), render: (r) => <span className="font-semibold">{pickLabel((r.name_json ?? r.name) as never, lang)}</span> },
          { key: 'system', label: t('roles.system'), width: '90px', render: (r) => (Number(r.system) === 1 ? <Badge tone="warn">{tc('yes')}</Badge> : <Badge>{tc('no')}</Badge>) },
          { key: 'perms', label: t('roles.nPerms'), width: '80px', render: (r) => <Badge tone="info">{Array.isArray(r.perms_json) ? (r.perms_json as string[]).length : '—'}</Badge> },
        ]}
        fields={[
          { key: 'role_key', label: `${tc('code')} (chef_service)`, required: true },
          { key: 'name_json.fr', label: `${tc('title')} (FR)`, required: true },
          { key: 'name_json.ar', label: `${tc('title')} (ع)` },
        ]}
        transformCreate={(v) => ({ role_key: v.role_key, name: { fr: v['name_json.fr'], ar: v['name_json.ar'] }, perms: [] })}
        transformUpdate={(v, row) => ({
          name: { fr: v['name_json.fr'], ar: v['name_json.ar'] },
          perms: Array.isArray(row.perms_json) ? (row.perms_json as string[]) : row.perms_json ? JSON.parse(String(row.perms_json)) : [],
        })}
      />
      <MatrixDialog open={matrixOpen} onClose={() => setMatrixOpen(false)} />
    </>
  );
}

function MatrixDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const { lang } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['perm-matrix'], queryFn: () => api.get<Matrix>('/admin/permissions-matrix'), enabled: open });
  const [roleIdx, setRoleIdx] = useState(0);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const role = q.data?.roles[roleIdx];
  useEffect(() => {
    setDraft(role ? new Set(role.perms) : null);
  }, [roleIdx, role?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mods = useMemo(() => (q.data?.modules ?? []).map((m) => (typeof m === 'string' ? { key: m } : m)), [q.data]);
  const acts = useMemo(() => (q.data?.actions ?? []).map((a) => (typeof a === 'string' ? { key: a } : a)), [q.data]);

  const mut = useMutation({
    mutationFn: () => api.put(`/roles/${role?.id}`, { name: role?.name, perms: [...(draft ?? [])] }),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['perm-matrix'] });
      void qc.invalidateQueries({ queryKey: ['list', 'roles'] });
    },
  });

  return (
    <Dialog open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Grid3X3 size={16} /> {t('roles.matrix')}</span>} wide>
      <div className="flex flex-wrap gap-1">
        {(q.data?.roles ?? []).map((r, i) => (
          <button key={r.id} onClick={() => setRoleIdx(i)} className={`badge ${i === roleIdx ? 'border-[rgb(var(--c-primary))] bg-[rgb(var(--c-primary-soft))] font-bold' : ''}`}>
            {pickLabel(r.name as never, lang) || r.key} {r.system ? '⚙' : ''}
          </button>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="dt-table">
          <thead>
            <tr>
              <th>{t('roles.module')}</th>
              {acts.map((a) => (
                <th key={a.key} className="text-center">{typeof a === 'object' && a.label ? pickLabel(a.label as never, lang) : a.key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr key={m.key}>
                <td className="font-semibold">{typeof m === 'object' && m.label ? pickLabel(m.label as never, lang) : m.key}</td>
                {acts.map((a) => {
                  const perm = `${m.key}.${a.key}`;
                  const on = draft?.has(perm) ?? false;
                  return (
                    <td key={a.key} className="text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[rgb(var(--c-primary))]"
                        checked={on}
                        onChange={() =>
                          setDraft((d) => {
                            const n = new Set(d ?? []);
                            if (n.has(perm)) n.delete(perm);
                            else n.add(perm);
                            return n;
                          })
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Checkbox label={t('roles.selectAll')} onChange={(e) => setDraft(e.target.checked ? new Set(mods.flatMap((m) => acts.map((a) => `${m.key}.${a.key}`))) : new Set())} />
        <Button className="ms-auto" variant="primary" loading={mut.isPending} disabled={!role || role.system} onClick={() => mut.mutate()}>
          <Save size={14} /> {tc('save')}
        </Button>
      </div>
      {role?.system ? <p className="mt-2 text-[12px] text-[rgb(var(--c-muted))]">{t('roles.systemHint')}</p> : null}
    </Dialog>
  );
}
