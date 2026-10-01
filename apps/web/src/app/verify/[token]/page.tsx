'use client';
/**
 * Page publique de vérification (QR ordonnances/badges) — AUCUNE donnée personnelle affichée :
 * uniquement authenticité du code, type d’entité et dates. Le jeton est aléatoire signé, jamais un id.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BadgeCheck, Clock, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/format';

interface VerifyResp {
  ok: boolean;
  entity?: string;
  code?: string;
  issuedAt?: string;
  expiresAt?: string | null;
  revoked?: boolean;
  error?: string;
}

export default function VerifyPage({ params }: { params: Promise<{ token: string }> }): React.ReactElement {
  const { t } = useT('common');
  const { lang } = useT('patient');
  void lang;
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [data, setData] = useState<VerifyResp | null>(null);

  useEffect(() => {
    void (async () => {
      const { token } = await params;
      try {
        const res = await fetch(`/api/v1/verify/${encodeURIComponent(token)}`);
        const j = (await res.json()) as VerifyResp;
        setData(j);
        setState('done');
      } catch {
        setState('error');
      }
    })();
  }, [params]);

  const ok = data?.ok && !data?.error;
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="bg-blob left-[-6%] top-[-10%] h-[42vw] w-[42vw] bg-[rgb(var(--c-primary)/0.28)]" />
        <div className="bg-blob blob-2 bottom-[-14%] end-[-8%] h-[38vw] w-[38vw] bg-[rgb(var(--c-mint)/0.25)]" />
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.97, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-md">
        <div className="glass-card p-6 text-center shadow-[var(--shadow-lift)]">
          <div className="mb-3 flex items-center justify-center gap-2 font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[rgb(var(--c-primary))] text-white">S</span>
            <span>sarDPI</span>
          </div>
          {state === 'loading' ? (
            <div className="skeleton mx-auto h-24 w-full" />
          ) : state === 'error' || !data ? (
            <Result tone="bad" icon={<ShieldQuestion size={34} />} title={t('verify.error')} />
          ) : ok ? (
            <Result tone="ok" icon={<BadgeCheck size={34} />} title={t('verify.valid')} sub={t('verify.validHint')}>
              <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[rgb(var(--c-muted))]">{t('verify.entity')}</span>
                  <b>{fmtEntity(data.entity)}</b>
                </div>
                <div dir="ltr" className="rounded-xl bg-[rgb(var(--c-surface-2))] py-1.5 font-mono text-[14px] font-bold">
                  {data.code}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[12px] text-[rgb(var(--c-muted))]">
                  <Clock size={12} /> {t('verify.issued')}: {data.issuedAt ? fmtDateTime(data.issuedAt, 'fr') : '—'}
                  {data.expiresAt ? ` · ${t('verify.expires')}: ${fmtDateTime(data.expiresAt, 'fr')}` : ''}
                </div>
              </div>
            </Result>
          ) : (
            <Result tone="bad" icon={<ShieldAlert size={34} />} title={data.error === 'errors.invalidToken' ? t('verify.invalid') : t('verify.expired')} sub={t('verify.invalidHint')} />
          )}
          <p className="mt-4 text-[11px] text-[rgb(var(--c-muted))]">{t('verify.noPii')}</p>
        </div>
      </motion.div>
    </div>
  );
}

function fmtEntity(e?: string): string {
  switch (e) {
    case 'prescription':
      return 'Ordonnance';
    case 'record':
      return 'Document médical';
    case 'patient':
      return 'Patient';
    default:
      return e ?? '—';
  }
}

function Result({ tone, icon, title, sub, children }: { tone: 'ok' | 'bad'; icon: React.ReactNode; title: string; sub?: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'ok' ? 'border-[rgb(var(--c-ok)/0.4)] bg-[rgb(var(--c-ok-soft)/0.6)] text-[rgb(var(--c-ok))]' : 'border-[rgb(var(--c-coral)/0.4)] bg-[rgb(var(--c-coral-soft)/0.6)] text-[rgb(var(--c-coral))]'}`}>
      <div className="mb-1 flex justify-center">{icon}</div>
      <p className="text-[15px] font-bold">{title}</p>
      {sub ? <p className="mt-0.5 text-[12px] opacity-80">{sub}</p> : null}
      {children}
    </div>
  );
}
