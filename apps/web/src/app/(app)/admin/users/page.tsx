'use client';
/** Utilisateurs — comptes, rôles, état, réinitialisation de mot de passe, 2FA. */
import React from 'react';
import { BadgeCheck, KeyRound, UserCog } from 'lucide-react';
import { Badge } from '@/components/ui';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { userCreateZ } from '@sardpi/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function AdminUsersPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const roles = useQuery({ queryKey: ['roles-lite'], queryFn: () => api.get<{ rows: { id: number; role_key: string }[] }>('/roles?pageSize=50') });
  return (
    <CrudModule
      resource="users"
      title={t('admin.users')}
      subtitle={t('users.subtitle')}
      scopeSelect
      defaultSort={{ id: 'id', desc: false }}
      schema={has('users', 'create') ? userCreateZ : undefined}
      canCreate={has('users', 'create')}
      canUpdate={has('users', 'update')}
      canArchive={has('users', 'archive')}
      canExport={false}
      createLabel={t('users.new')}
      cardTitle={(r) => fmtVal(r.full_name ?? r.username)}
      cardSubtitle={(r) => <BizCode code={`USR-${fmtVal(r.id)}`} />}
      cardBadges={(r) => <Badge tone="info">{fmtVal(r.role_key ?? r.role_id)}</Badge>}
      rowMenu={(r) => (
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] font-medium hover:bg-[rgb(var(--c-surface-2))]"
          onClick={async () => {
            const v = window.prompt(`${t('users.resetPw')} — ${String(r.username)}`);
            if (v && v.length >= 10) await api.post(`/users/${r.id}/reset-password`, { password: v });
          }}
        >
          <KeyRound size={14} /> {t('users.resetPw')}
        </button>
      )}
      columns={[
        { key: 'username', label: tc('username'), sortable: true, width: '140px', render: (r) => <span className="flex items-center gap-2 font-semibold"><UserCog size={13} className="text-[rgb(var(--c-muted))]" />{fmtVal(r.username)}</span> },
        { key: 'full_name', label: t('users.fullName') },
        { key: 'email', label: 'e-mail', render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.email)}</span> },
        { key: 'role_id', label: t('users.role'), width: '110px', render: (r) => <Badge tone="info">{fmtVal(r.role_key ?? r.role_id)}</Badge> },
        { key: 'locale', label: tc('lang'), width: '64px', hideByDefault: true },
        { key: 'totp_enabled', label: '2FA', width: '64px', render: (r) => (Number(r.totp_enabled) === 1 ? <Badge tone="ok"><BadgeCheck size={11} /></Badge> : <Badge>—</Badge>) },
        { key: 'must_change_password', label: t('users.mustChange'), width: '80px', hideByDefault: true, render: (r) => (Number(r.must_change_password) === 1 ? <Badge tone="warn">{tc('yes')}</Badge> : <Badge tone="ok">{tc('no')}</Badge>) },
        { key: 'is_active', label: tc('active'), width: '80px', render: (r) => (Number(r.is_active) === 1 ? <Badge tone="ok">{tc('yes')}</Badge> : <Badge tone="danger">{tc('no')}</Badge>) },
        { key: 'last_login_at', label: t('users.lastLogin'), width: '140px', hideByDefault: true, sortable: true, render: (r) => <span className="font-mono text-[11.5px]">{fmtVal(r.last_login_at).slice(0, 16)}</span> },
      ]}
      filterFields={[
        { field: 'role_id', label: t('users.role'), kind: 'select', options: (roles.data?.rows ?? []).map((x) => ({ value: String(x.id), label: x.role_key })) },
        { field: 'is_active', label: tc('active'), kind: 'select', options: [{ value: '1', label: tc('yes') }, { value: '0', label: tc('no') }] },
      ]}
      fields={[
        { key: 'username', label: t('users.username'), required: true },
        { key: 'email', label: 'e-mail', kind: 'email', required: true },
        { key: 'fullName', label: t('users.fullName'), required: true },
        { key: 'password', label: t('users.password'), kind: 'password', required: true, hint: t('users.pwHint') },
        { key: 'roleId', label: t('users.role'), kind: 'select', options: (roles.data?.rows ?? []).map((x) => ({ value: String(x.id), label: x.role_key })), required: true },
        { key: 'locale', label: t('users.lang'), kind: 'select', options: [{ value: 'fr', label: 'FR' }, { value: 'ar', label: 'ع' }, { value: 'es', label: 'ES' }, { value: 'en', label: 'EN' }] },
        { key: 'phone', label: t('field.phone'), kind: 'tel' },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
      transformCreate={(v) => ({ ...v, roleId: Number(v.roleId) })}
      transformUpdate={(v) => {
        const out = { ...v };
        if (out.roleId) out.roleId = Number(out.roleId);
        if (!out.password) delete out.password;
        return out;
      }}
    />
  );
}
