'use client';
/** Profil utilisateur — identité, mot de passe, 2FA TOTP (QR + confirmation), sessions actives (révocables), préférences UI. */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Monitor, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui';
import { fmtVal } from '@/components/crud';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { useUi } from '@/stores/ui';

export default function ProfilePage(): React.ReactElement {
  const { t } = useT('auth');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const ui = useUi();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-[20px] font-bold">{t('profile.title')}</h1>
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[rgb(var(--c-primary))] text-xl font-bold text-white">{(user?.fullName ?? '?').slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="text-[16px] font-bold">{user?.fullName}</div>
            <div className="text-[12.5px] text-[rgb(var(--c-muted))]">@{user?.username} · {user?.email}</div>
          </div>
          <Badge tone={user?.totpEnabled ? 'ok' : 'warn'} className="ms-auto">
            <ShieldCheck size={12} /> {user?.totpEnabled ? t('totp.enabled') : t('totp.disabled')}
          </Badge>
        </div>
      </Card>
      <PasswordCard />
      <TotpCard />
      <SessionsCard onDone={() => void qc.invalidateQueries({ queryKey: ['sessions'] })} />
      <Card className="flex flex-wrap items-center gap-4">
        <span className="text-[13.5px] font-bold">{tc('ui.title')}</span>
        <Field label={tc('ui.dark')}>
          <Select
            value={ui.themeMode}
            onChange={(e) => ui.set({ themeMode: e.target.value as 'light' | 'dark' | 'system' })}
            options={[
              { value: 'light', label: tc('ui.light') },
              { value: 'dark', label: tc('ui.darkMode') },
              { value: 'system', label: tc('ui.system') },
            ]}
          />
        </Field>
        <Field label={tc('ui.density')}>
          <Select
            value={ui.density ?? ''}
            onChange={(e) => ui.set({ density: (e.target.value || null) as 'compact' | 'comfortable' | null })}
            options={[
              { value: '', label: tc('ui.followUser') },
              { value: 'comfortable', label: tc('ui.comfortable') },
              { value: 'compact', label: tc('ui.compact') },
            ]}
          />
        </Field>
        <Field label={tc('ui.motion')}>
          <Select
            value={ui.motion ? '1' : '0'}
            onChange={(e) => ui.set({ motion: e.target.value === '1' })}
            options={[
              { value: '1', label: tc('yes') },
              { value: '0', label: tc('no') },
            ]}
          />
        </Field>
      </Card>
      <div className="text-end">
        <Button variant="danger" onClick={() => void useAuth.getState().logout()}>
          <LogOut size={14} /> {t('logout')}
        </Button>
      </div>
    </div>
  );
}

function PasswordCard(): React.ReactElement {
  const { t } = useT('auth');
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post('/auth/password', { current: cur, next }),
    onSuccess: () => {
      toast.success(t('password.changed'));
      setCur('');
      setNext('');
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'server'}`)),
  });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[14px] font-bold">
        <KeyRound size={15} className="text-[rgb(var(--c-primary))]" /> {t('password.title')}
      </h2>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label={t('password.current')}>
          <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label={t('password.next')} hint={t('password.policyHint')}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!cur || next.length < 10} loading={mut.isPending} onClick={() => mut.mutate()}>
          {t('password.save')}
        </Button>
      </div>
    </Card>
  );
}

function TotpCard(): React.ReactElement {
  const { t } = useT('auth');
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const refresh = useAuth((s) => s.refreshNow);
  const [setup, setSetup] = useState<{ svg: string; secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const start = useMutation({
    mutationFn: () => api.post<{ svg: string; secret: string; uri: string }>('/auth/totp/setup', {}),
    onSuccess: (r) => setSetup(r),
  });
  const confirm = useMutation({
    mutationFn: () => api.post('/auth/totp/confirm', { code, secret: setup?.secret }),
    onSuccess: async () => {
      toast.success('✓');
      setSetup(null);
      setCode('');
      await refresh();
    },
  });
  void user;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[14px] font-bold">
        <ShieldCheck size={15} className="text-[rgb(var(--c-ok))]" /> {t('totp.title')}
      </h2>
      {setup ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.svg }} />
          <div className="min-w-[220px] flex-1">
            <p className="mb-1 text-[12px] text-[rgb(var(--c-muted))]">{t('totp.scan')}</p>
            <code dir="ltr" className="block break-all rounded-lg bg-[rgb(var(--c-surface-2))] p-2 font-mono text-[11px]">{setup.secret}</code>
            <div className="mt-2 flex gap-2">
              <Input className="max-w-[140px] font-mono tracking-widest" placeholder="123456" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button variant="ok" disabled={code.length !== 6} loading={confirm.isPending} onClick={() => confirm.mutate()}>{t('totp.enable')}</Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>{t('cancel')}</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button variant="ghost" loading={start.isPending} onClick={() => start.mutate()}>
            {t('totp.setup')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function SessionsCard({ onDone }: { onDone: () => void }): React.ReactElement {
  const { t } = useT('auth');
  const { t: tc } = useT('common');
  const toast = useToast();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ rows: { id: number; ua: string | null; ip: string | null; created_at: string; last_seen: string | null; current: boolean }[] }>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: number | 'all') => api.post('/auth/sessions/revoke', id === 'all' ? { all: true } : { id }),
    onSuccess: () => {
      toast.success(tc('saved'));
      onDone();
    },
  });
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="flex items-center justify-between text-[14px] font-bold">
        <span className="flex items-center gap-2">
          <Monitor size={15} className="text-[rgb(var(--c-info))]" /> {t('sessions.title')}
        </span>
        <Button size="sm" variant="danger" onClick={() => revoke.mutate('all')}>
          {t('sessions.revokeAll')}
        </Button>
      </h2>
      {(q.data?.rows ?? []).map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded-xl border border-[rgb(var(--c-line)/0.6)] px-3 py-2 text-[12.5px]">
          <Badge tone={s.current ? 'ok' : 'neutral'}>{s.current ? t('sessions.current') : fmtVal(s.ip)}</Badge>
          <span className="min-w-0 flex-1 truncate opacity-80">{fmtVal(s.ua)}</span>
          <span className="font-mono text-[11px] text-[rgb(var(--c-muted))]">{fmtVal(s.last_seen ?? s.created_at).slice(0, 16)}</span>
          {!s.current ? (
            <button className="opacity-60 hover:opacity-100" onClick={() => revoke.mutate(s.id)} title={t('sessions.revoke')}>
              <LogOut size={13} />
            </button>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
