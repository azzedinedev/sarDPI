'use client';
/** Pharmacie — catalogue médicaments (DRG), stock & mouvements, seuils d’alerte. */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, PackageMinus, PackagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Field, Input, Select, Tabs, Textarea } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { BizCode } from '@/components/biz-code';
import { CrudModule, fmtVal } from '@/components/crud';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';

export default function PharmacyPage(): React.ReactElement {
  const { t } = useT('pharmacy');
  const [tab, setTab] = useState('drugs');
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'drugs', label: t('drugs') },
          { key: 'stock', label: t('stock.title') },
          { key: 'movements', label: t('stock.movements') },
        ]}
      />
      {tab === 'drugs' ? <DrugsTab /> : tab === 'stock' ? <StockTab /> : <StockMovementsTab />}
    </div>
  );
}

function DrugsTab(): React.ReactElement {
  const { t } = useT('pharmacy');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  return (
    <CrudModule
      resource="drugs"
      title={t('drugs')}
      search
      canCreate={has('pharmacy', 'create')}
      canArchive={has('pharmacy', 'archive')}
      canExport={false}
      defaultSort={{ id: 'id', desc: true }}
      cardTitle={(r) => fmtVal(r.trade_name)}
      cardSubtitle={(r) => fmtVal(r.dci)}
      cardBadges={(r) => (
        <>
          <Badge tone="info">{fmtVal(r.atc ?? 'ATC —')}</Badge>
          {Number(r.active) === 1 ? <Badge tone="ok">{tc('active')}</Badge> : <Badge>{tc('inactive')}</Badge>}
        </>
      )}
      columns={[
        { key: 'code', label: tc('code'), width: '110px', render: (r) => <BizCode code={r.code as string} /> },
        { key: 'trade_name', label: t('tradeName'), sortable: true, render: (r) => <span className="font-semibold">{fmtVal(r.trade_name)}</span> },
        { key: 'dci', label: 'DCI', sortable: true },
        { key: 'form', label: t('form'), width: '110px', hideByDefault: true },
        { key: 'strength', label: t('strength'), width: '90px', hideByDefault: true },
        { key: 'atc', label: 'ATC', width: '84px', render: (r) => <span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.atc)}</span> },
        { key: 'price', label: t('price'), width: '96px', render: (r) => <span className="font-mono">{fmtVal(r.price)}</span> },
        { key: 'requires_prescription', label: t('rxOnly'), width: '70px', render: (r) => (Number(r.requires_prescription) === 1 ? <Badge tone="warn">℞</Badge> : <Badge tone="ok">OTC</Badge>) },
        { key: 'stock_qty', label: t('stock.qty'), width: '84px', render: (r) => <Badge tone={Number(r.stock_qty) <= Number(r.alert_threshold ?? 0) ? 'danger' : 'neutral'}>{fmtVal(r.stock_qty ?? 0)}</Badge> },
      ]}
      fields={[
        { key: 'tradeName', label: t('tradeName'), required: true },
        { key: 'dci', label: 'DCI', required: true },
        { key: 'form', label: t('form') },
        { key: 'strength', label: t('strength') },
        { key: 'atc', label: 'ATC', hint: t('atcHint') },
        { key: 'packSize', label: t('packSize'), kind: 'number', min: 1 },
        { key: 'price', label: t('price'), kind: 'number', step: 0.01 },
        { key: 'requiresPrescription', label: t('rxOnly'), kind: 'checkbox' },
        { key: 'active', label: tc('active'), kind: 'checkbox' },
      ]}
    />
  );
}

function StockTab(): React.ReactElement {
  const { t } = useT('pharmacy');
  const { t: tc } = useT('common');
  const has = useAuth((s) => s.has);
  const qc = useQuery;
  void qc;
  const [move, setMove] = useState<{ drugId: number; code: string; dir: 'in' | 'out'; batch: string; expiry: string | null } | null>(null);
  const [q, setQ] = useState('');
  const rows = useQuery({ queryKey: ['stock', q], queryFn: () => api.get<{ rows: StockRow[] }>(`/stock`) });
  const filtered = (rows.data?.rows ?? []).filter((r) => !q || `${r.drug} ${r.batch ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="glass-card flex items-center gap-2 !p-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stock.search')} className="!min-h-9 max-w-sm" />
      </div>
      <div className="glass-card overflow-x-auto !p-0">
        <table className="dt-table">
          <thead>
            <tr>
              <th>{t('tradeName')}</th>
              <th>{t('stock.batch')}</th>
              <th>{t('stock.qty')}</th>
              <th>{t('stock.expiry')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const low = r.out || r.low;
              return (
                <tr key={r.id} className={low ? 'bg-[rgb(var(--c-coral-soft)/0.4)]' : r.expiringSoon ? 'bg-[rgb(var(--c-amber-soft)/0.4)]' : undefined}>
                  <td className="font-semibold">{fmtVal(r.drug)}</td>
                  <td><span dir="ltr" className="font-mono text-[12px]">{fmtVal(r.batch)}</span></td>
                  <td className="font-mono">
                    {r.qty} {low ? <Badge tone="danger">{t('stock.low')}</Badge> : null}
                  </td>
                  <td className="font-mono text-[12px]">
                    {fmtVal(r.expiry).slice(0, 10)}
                    {r.expiringSoon ? <Badge tone="warn">{r.expiringDays} j</Badge> : null}
                  </td>
                  <td className="text-end">
                    <div className="inline-flex gap-1">
                      {has('pharmacy', 'update') ? (
                        <>
                          <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={t('stock.in')} onClick={() => setMove({ drugId: r.drug_id, code: String(r.drug), dir: 'in', batch: String(r.batch ?? 'LOT-001'), expiry: r.expiry ?? null })}>
                            <PackagePlus size={13} />
                          </Button>
                          <Button size="sm" variant="ghost" className="btn-icon !min-h-7 !min-w-7" title={t('stock.out')} onClick={() => setMove({ drugId: r.drug_id, code: String(r.drug), dir: 'out', batch: String(r.batch ?? 'LOT-001'), expiry: r.expiry ?? null })}>
                            <PackageMinus size={13} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MoveDialog move={move} onClose={() => setMove(null)} />
    </>
  );
}

function MoveDialog({ move, onClose }: { move: { drugId: number; code: string; dir: 'in' | 'out'; batch: string; expiry: string | null } | null; onClose: () => void }): React.ReactElement {
  const { t } = useT('pharmacy');
  const { t: tc } = useT('common');
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [batch, setBatch] = useState(move?.batch ?? 'LOT-001');
  const [expiry, setExpiry] = useState(move?.expiry ?? '');
  const [reason, setReason] = useState('');
  React.useEffect(() => {
    setBatch(move?.batch ?? 'LOT-001');
    setExpiry(move?.expiry ?? '');
  }, [move]);
  const save = async (): Promise<void> => {
    if (!move) return;
    try {
      await api.post('/stock/move', { drugId: move.drugId, batch, delta: move.dir === 'in' ? qty : -qty, reason: reason || undefined, expiry: expiry || undefined });
      toast.success(tc('saved'));
      onClose();
    } catch (e) {
      toast.error(t(`errors.${(e as { code?: string; message?: string }).code ?? (e as { message?: string }).message ?? 'network'}`));
    }
  };
  return (
    <Dialog open={Boolean(move)} onClose={onClose} title={`${t('stock.move')} — ${move?.code ?? ''}`} footer={<><Button onClick={onClose}>{tc('cancel')}</Button><Button variant="primary" onClick={() => void save()}>{tc('save')}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label={t('stock.qty')} required>
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('stock.batch')} required>
            <Input value={batch} onChange={(e) => setBatch(e.target.value)} className="font-mono" />
          </Field>
          <Field label={t('stock.expiry')}>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </div>
        <Field label={t('stock.reason')}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

interface StockRow {
  id: number;
  drug_id: number;
  drug: string;
  dci: string | null;
  batch: string;
  qty: number;
  low: boolean;
  out: boolean;
  expiry: string | null;
  expiringDays: number | null;
  expiringSoon: boolean;
}

function StockMovementsTab(): React.ReactElement {
  const { t } = useT('pharmacy');
  const { t: tc } = useT('common');
  const rows = useQuery({ queryKey: ['stock-moves'], queryFn: () => api.get<{ rows: { id: number; at: string; drug: string; delta: number; reason: string | null; who: string | null }[] }>('/stock/movements?limit=200').catch(() => ({ rows: [] })) });
  return (
    <div className="glass-card overflow-x-auto !p-0">
      <table className="dt-table">
        <thead>
          <tr>
            <th>{tc('date')}</th>
            <th>{t('tradeName')}</th>
            <th />
            <th>{t('stock.qty')}</th>
            <th>{t('stock.reason')}</th>
            <th>{tc('user')}</th>
          </tr>
        </thead>
        <tbody>
          {(rows.data?.rows ?? []).map((m) => (
            <tr key={m.id}>
              <td className="font-mono text-[12px]">{fmtVal(m.at).slice(0, 16)}</td>
              <td className="font-semibold">{fmtVal(m.drug)}</td>
              <td><Badge tone={m.delta >= 0 ? 'ok' : 'warn'}>{m.delta >= 0 ? <PackagePlus size={11} /> : <PackageMinus size={11} />}</Badge></td>
              <td className="font-mono">{m.delta >= 0 ? '+' : ''}{fmtVal(m.delta)}</td>
              <td>{fmtVal(m.reason)}</td>
              <td>{fmtVal(m.who)}</td>
            </tr>
          ))}
          {!(rows.data?.rows ?? []).length ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-[12.5px] text-[rgb(var(--c-muted))]"><ArrowDownUp size={16} className="me-1 inline" /> {t('stock.empty')}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
