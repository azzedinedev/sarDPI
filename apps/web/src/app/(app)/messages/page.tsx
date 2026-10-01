'use client';
/** Messagerie — file d’envoi e-mail (hors-ligne : messages « skipped » si SMTP non configuré), retry manuel. */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, RotateCcw, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { BizCode } from '@/components/biz-code';
import { fmtVal } from '@/components/crud';
import { Card } from '@/components/crud';

interface Msg {
  id: number;
  code: string | null;
  to_email: string;
  subject: string;
  status: string;
  lang: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  template: string | null;
}

export default function MessagesPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const q = useQuery({ queryKey: ['messages', status], queryFn: () => api.get<{ rows: Msg[]; outboxHint: string | null }>('/messages', { status: status || undefined }) });
  const retry = useMutation({
    mutationFn: (id: number) => api.post(`/messages/${id}/retry`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['messages'] }),
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-bold">{t('mail.title')}</h1>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('mail.subtitle')}</p>
        </div>
        <Button className="ms-auto" variant="primary" onClick={() => setSendOpen(true)}>
          <Send size={15} /> {t('mail.send')}
        </Button>
      </div>
      {q.data?.outboxHint ? (
        <p className="flex items-center gap-2 rounded-xl bg-[rgb(var(--c-amber-soft))] px-3 py-2 text-[12.5px] font-semibold text-[rgb(var(--c-amber))]">
          <Info size={14} /> {q.data.outboxHint}
        </p>
      ) : null}
      <Tabs
        active={status}
        onChange={setStatus}
        tabs={[
          { key: '', label: tc('all') },
          { key: 'queued', label: t('mail.queued') },
          { key: 'sent', label: t('mail.sent') },
          { key: 'skipped', label: t('mail.skipped') },
          { key: 'failed', label: t('mail.failed') },
        ]}
      />
      <Card className="overflow-x-auto !p-0">
        <table className="dt-table">
          <thead>
            <tr>
              <th>{tc('code')}</th>
              <th>→</th>
              <th>{t('mail.subject')}</th>
              <th>{t('mail.status')}</th>
              <th>{tc('date')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><BizCode code={m.code} /></td>
                <td dir="ltr" className="font-mono text-[12px]">{fmtVal(m.to_email)}</td>
                <td className="max-w-[380px] truncate font-semibold">{fmtVal(m.subject)}</td>
                <td>
                  <Badge tone={m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'danger' : m.status === 'skipped' ? 'warn' : 'info'}>{fmtVal(m.status)}</Badge>
                </td>
                <td className="font-mono text-[11.5px] text-[rgb(var(--c-muted))]">{fmtVal(m.sent_at ?? m.created_at).slice(0, 16)}</td>
                <td className="text-end">
                  {m.status === 'failed' || m.status === 'skipped' ? (
                    <Button size="sm" variant="ghost" className="btn-icon !min-h-7" title={t('mail.retry')} loading={retry.isPending} onClick={() => retry.mutate(m.id)}>
                      <RotateCcw size={13} />
                    </Button>
                  ) : m.error ? (
                    <span className="text-[11px] text-[rgb(var(--c-coral))]" title={String(m.error)}>⚠</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[12.5px] text-[rgb(var(--c-muted))]">{t('mail.empty')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <SendDialog open={sendOpen} onClose={() => setSendOpen(false)} onSent={() => void qc.invalidateQueries({ queryKey: ['messages'] })} />
    </div>
  );
}

function SendDialog({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: () => void }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const [to, setTo] = useState('');
  const [tpl, setTpl] = useState('');
  const [lang, setLang] = useState('fr');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post('/messages/send', { ...(to ? { to } : {}), ...(tpl ? { template: tpl } : {}), lang, ...(subject ? { subject } : {}), ...(body ? { body } : {}) }),
    onSuccess: () => {
      onSent();
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('mail.send')} footer={<><Button onClick={onClose}>{tc('cancel')}</Button><Button variant="primary" disabled={!to && !tpl} loading={mut.isPending} onClick={() => mut.mutate()}>{t('mail.queue')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('mail.to')} hint={t('mail.toHint')}>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="patient@exemple.dz" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('mail.template')}>
            <Select value={tpl} onChange={(e) => setTpl(e.target.value)} options={[
              { value: '', label: '—' },
              { value: 'appointment_reminder', label: 'RDV' },
              { value: 'document_sent', label: 'DOC' },
              { value: 'account_activation', label: 'ACT' },
              { value: 'test', label: 'TEST' },
            ]} />
          </Field>
          <Field label={tc('lang')}>
            <Select value={lang} onChange={(e) => setLang(e.target.value)} options={[
              { value: 'fr', label: 'FR' },
              { value: 'ar', label: 'ع' },
              { value: 'es', label: 'ES' },
              { value: 'en', label: 'EN' },
            ]} />
          </Field>
        </div>
        <Field label={t('mail.subject')}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={t('mail.body')}>
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
