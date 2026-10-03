'use client';
/** Mot de passe oublié — e-mail de réinitialisation (hors-ligne : jeton dans la file/audit, lien à ouvrir manuellement). */
import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { KeyRound, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useT, useI18n } from '@/lib/i18n';
import { Button, Field, Input } from '@/components/ui';

export default function ForgotPage(): React.ReactElement {
  const { t } = useT('auth');
  const { lang } = useI18n();
  const [id, setId] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot', { identifier: id, lang });
      setSent(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="bg-blob left-[-8%] top-[-12%] h-[46vw] w-[46vw] bg-[rgb(var(--c-primary)/0.3)]" />
      </div>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-card w-full max-w-[420px] p-6 shadow-[var(--shadow-lift)]">
        <h1 className="mb-1 flex items-center gap-2 text-[18px] font-bold">
          <KeyRound size={18} className="text-[rgb(var(--c-primary))]" /> {t('forgot.title')}
        </h1>
        {sent ? (
          <div className="flex items-center gap-2 rounded-xl bg-[rgb(var(--c-ok-soft))] p-3 text-[13px] font-semibold text-[rgb(var(--c-ok))]">
            <MailCheck size={16} /> {t('forgot.sent')}
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e as unknown as React.FormEvent)} className="mt-3 flex flex-col gap-3">
            <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('forgot.hint')}</p>
            <Field label={t('login.identifier')}>
              <Input autoFocus value={id} onChange={(e) => setId(e.target.value)} required placeholder="user@clinique.dz" />
            </Field>
            <Button type="submit" variant="primary" loading={busy}>
              {t('forgot.submit')}
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-4 block text-center text-[12.5px] font-semibold text-[rgb(var(--c-primary))] hover:underline">
          ← {t('login.back')}
        </Link>
      </motion.div>
    </div>
  );
}
