'use client';
/** Fiche ordonnance — lignes, statut, validation, impression (rendu serveur PDF-ready), QR de vérification. */
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Pencil, Printer, QrCode, Trash2, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button } from '@/components/ui';
import { Card } from '@/components/crud';
import { BizCode } from '@/components/biz-code';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { Dialog } from '@/components/dialogs';
import { fmtVal } from '@/components/crud';

export default function RxDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const rid = Number(id);
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const router = useRouter();
  const toast = useToast();
  const has = useAuth((s) => s.has);
  const qc = useQueryClient();
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const q = useQuery({ queryKey: ['rx', rid], queryFn: () => api.get<Rx>(`/prescriptions/${rid}`) });
  const validate = useMutation({
    mutationFn: () => api.post(`/prescriptions/${rid}/validate`, {}),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['rx', rid] });
    },
  });
  const toggleLock = useMutation({
    mutationFn: (lock: boolean) => api.post(`/prescriptions/${rid}/lock`, { lock: lock ? '1' : '0' }),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['rx', rid] });
    },
  });

  if (q.isLoading) return <Card><div className="skeleton h-40" /></Card>;
  if (q.isError) return <Card><p className="text-sm">{tc('notFound')}</p></Card>;
  const rx = q.data!;
  const isLocked = Boolean(rx.locked_at) || rx.status === 'validated';
  const qrUrl = rx.verify_token ? `${window.location.origin}/verify/${rx.verify_token}` : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-bold">{t('rx.rx')}</h1>
            <BizCode code={rx.code} />
            <Badge tone={rx.status === 'validated' ? 'ok' : rx.status === 'cancelled' ? 'danger' : 'warn'}>{fmtVal(rx.status)}</Badge>
            {isLocked ? <Badge tone="warn"><Lock size={11} /> {t('rx.lockedBadge')}</Badge> : null}
          </div>
          <p className="mt-1 text-[12.5px] text-[rgb(var(--c-muted))]">
            {rx.patient?.last_name} {rx.patient?.first_name} · <span dir="ltr" className="font-mono">{fmtVal(rx.patient?.code)}</span> · {fmtVal(rx.act_date ?? rx.created_at).slice(0, 10)} — {rx.practitioner?.name}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap gap-1.5">
          {has('prescriptions', 'update') && !isLocked ? (
            <Button size="sm" variant="ghost" onClick={() => router.push(`/prescriptions/new?id=${rid}`)}>
              <Pencil size={14} /> {tc('edit')}
            </Button>
          ) : null}
          {has('prescriptions', 'validate') ? (
            <Button size="sm" variant="ghost" loading={toggleLock.isPending} onClick={() => toggleLock.mutate(!isLocked)} title={isLocked ? t('rx.unlock') : t('rx.lock')}>
              {isLocked ? <Unlock size={14} /> : <Lock size={14} />} {isLocked ? t('rx.unlock') : t('rx.lock')}
            </Button>
          ) : null}
          {has('prescriptions', 'validate') && rx.status !== 'validated' ? (
            <Button size="sm" variant="ok" loading={validate.isPending} onClick={() => validate.mutate()}>
              <CheckCircle2 size={14} /> {t('rx.validate')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setQrOpen(true)}>
            <QrCode size={14} /> {t('rx.verifyLink')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const html = await api.get<string>(`/documents/${encodeURIComponent(String(rx.code))}/print`).catch(() => null);
              if (html) setPrintHtml(html);
            }}
          >
            <Printer size={14} /> {tc('print')}
          </Button>
          {has('prescriptions', 'delete') ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void api
                  .del(`/prescriptions/${rid}`)
                  .then(() => {
                    toast.success(t('archived'));
                    router.push('/prescriptions');
                  })
                  .catch(() => undefined)
              }
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="!p-0">
        <table className="dt-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('rx.tradeName')}</th>
              <th>DCI</th>
              <th>{t('rx.form')}</th>
              <th>{t('rx.dosage')}</th>
              <th>{t('rx.quantity')}</th>
              <th>{t('rx.posology')}</th>
              <th>{t('rx.duration')}</th>
            </tr>
          </thead>
          <tbody>
            {(rx.lines ?? []).map((l, i) => (
              <tr key={i}>
                <td className="font-mono">{i + 1}</td>
                <td className="font-bold">{fmtVal(l.trade_name)}</td>
                <td>{fmtVal(l.dci)}</td>
                <td>{fmtVal(l.form)}</td>
                <td className="font-mono">{fmtVal(l.dosage)}</td>
                <td className="font-mono">{fmtVal(l.quantity)}</td>
                <td dir={/[\u0600-\u06FF]/.test(String(l.posology ?? '')) ? 'rtl' : 'ltr'}>{fmtVal(l.posology)}</td>
                <td className="font-mono">{fmtVal(l.duration_days)} j</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rx.notes ? <p className="border-t border-[rgb(var(--c-line)/0.6)] p-3 text-[12.5px] text-[rgb(var(--c-muted))]">{fmtVal(rx.notes)}</p> : null}
        {Number(rx.refills) > 0 ? <p className="px-3 pb-3 text-[12px]">{t('rx.refills')} : {fmtVal(rx.refills)}</p> : null}
      </Card>

      <Dialog open={Boolean(printHtml)} onClose={() => setPrintHtml(null)} title={tc('print')} wide>
        {printHtml ? (
          <>
            <iframe title="print" srcDoc={printHtml} className="h-[62vh] w-full rounded-xl border border-[rgb(var(--c-line))]" onLoad={(e) => (e.currentTarget.contentWindow?.focus(), e.currentTarget.contentWindow?.print())} />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="primary" size="sm" onClick={() => { const f = document.querySelector('iframe'); (f as HTMLIFrameElement | null)?.contentWindow?.print(); }}>
                {tc('print')}
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} title={t('rx.verifyLink')}>
        {qrUrl ? (
          <div className="flex flex-col items-center gap-2 p-2">
            <img alt="QR" src={`/api/v1/qr?data=${encodeURIComponent(qrUrl)}`} className="h-52 w-52 rounded-xl bg-white p-2 shadow" />
            <p dir="ltr" className="w-full break-all rounded-xl bg-[rgb(var(--c-surface-2))] p-2 text-center font-mono text-[11px]">{qrUrl}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => window.open(qrUrl, '_blank')}>{t('rx.openVerify')}</Button>
              <Button size="sm" variant="primary" onClick={() => void navigator.clipboard.writeText(qrUrl)}>{tc('copy')}</Button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-[rgb(var(--c-muted))]">{t('rx.noVerifyToken')}</p>
        )}
      </Dialog>
    </div>
  );
}

interface Rx {
  id: number;
  code: string | null;
  verify_token?: string | null;
  status: string;
  act_date?: string;
  created_at?: string;
  notes?: string | null;
  refills?: number;
  locked_at?: string | null;
  lines?: { trade_name: string; dci: string | null; form: string | null; dosage: string | null; quantity: number; posology: string; duration_days: number }[];
  patient?: { code: string; last_name: string; first_name: string } | null;
  practitioner?: { name: string; code: string } | null;
}
