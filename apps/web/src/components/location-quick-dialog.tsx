'use client';

/**
 * LocationQuickDialog — modale de création rapide d'un lieu de soin (cabinet, salle, labo, bloc).
 * Utilisable directement depuis les formulaires de fiches médicales, rendez-vous ou workflow
 * lorsqu'un lieu n'existe pas encore dans la liste.
 */
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';

export function LocationQuickDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (loc: { id: number; code: string; name: string }) => void;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();

  const [kind, setKind] = useState('labo');
  const [nameFr, setNameFr] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [building, setBuilding] = useState('');
  const [address, setAddress] = useState('');
  const [wilayaCode, setWilayaCode] = useState('');

  const valid = nameFr.trim().length >= 2;

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number; code: string; name?: string }>('/locations', {
        kind,
        name: { fr: nameFr.trim(), ar: nameAr.trim() || undefined },
        capacity: Number(capacity) || 1,
        building: building.trim() || null,
        address: address.trim() || null,
        wilayaCode: wilayaCode ? Number(wilayaCode) : null,
        active: true,
      }),
    onSuccess: (res) => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['locations'] });
      void qc.invalidateQueries({ queryKey: ['list', 'locations'] });
      void qc.invalidateQueries({ queryKey: ['loc-lite'] });
      onSaved?.({
        id: Number(res.id),
        code: res.code ?? `LOC-${res.id}`,
        name: nameFr.trim(),
      });
      onClose();
      // reset
      setNameFr('');
      setNameAr('');
      setBuilding('');
      setAddress('');
    },
    onError: (e: unknown) => toast.error(t(`errors.${(e as { code?: string }).code ?? 'network'}`)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('loc.new')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('loc.kind')} required>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={['labo', 'cabinet', 'salle', 'bloc', 'pharmacie', 'service', 'autre'].map((v) => ({
              value: v,
              label: t(`loc.k.${v}`),
            }))}
          />
        </Field>
        <Field label={t('loc.capacity')}>
          <Input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label={`${tc('title')} (FR)`} required>
          <Input value={nameFr} onChange={(e) => setNameFr(e.target.value)} placeholder="Ex: Laboratoire central, Salle d'analyse..." />
        </Field>
        <Field label={`${tc('title')} (ع)`}>
          <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="المخبر المركزي، قاعة التحاليل..." />
        </Field>
        <Field label={t('loc.building')}>
          <Input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Ex: Bâtiment B, Étage 1..." />
        </Field>
        <Field label={t('field.wilayaCode')}>
          <Input type="number" min={1} max={58} value={wilayaCode} onChange={(e) => setWilayaCode(e.target.value)} placeholder="1–58" />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('field.address')}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Adresse du lieu" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
