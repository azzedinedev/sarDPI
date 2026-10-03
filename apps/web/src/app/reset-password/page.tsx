'use client';
/** Réinitialisation du mot de passe via jeton signé (usage unique, TTL 1 h). */
import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { KeySquare } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input } from '@/components/ui';

export default function ResetPasswordPage(): React.ReactElement {
  const { t } = useT('auth');
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get('token') ?? '';
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    if (pw1 !== pw2) {
      setErr(t('reset.confirmMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset', { token, password: pw1 });
      router.replace('/login');
    } catch (x) {
      setErr(t((x as { code?: string }).code ?? 'errors.invalidToken'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card w-full max-w-[420px] p-6">
        <h1 className="mb-3 flex items-center gap-2 text-[18px] font-bold">
          <KeySquare size={18} className="text-[rgb(var(--c-primary))]" /> {t('reset.title')}
        </h1>
        {!token ? <p className="rounded-xl bg-[rgb(var(--c-coral-soft))] p-3 text-[13px] font-semibold">{t('reset.noToken')}</p> : null}
        {err ? <p className="mb-3 rounded-xl bg-[rgb(var(--c-coral-soft))] p-3 text-[13px] font-semibold text-[rgb(var(--c-coral))]">{err}</p> : null}
        <form onSubmit={(e) => void submit(e as unknown as React.FormEvent)} className="flex flex-col gap-3">
          <Field label={t('reset.new')} hint={t('reset.policy')}>
            <Input type="password" autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} required minLength={10} />
          </Field>
          <Field label={t('reset.confirm')}>
            <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!token}>
            {t('reset.submit')}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
