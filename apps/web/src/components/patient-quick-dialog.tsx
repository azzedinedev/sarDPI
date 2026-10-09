'use client';

/**
 * PatientQuickDialog — modal de création rapide d'un patient.
 * Utilisable directement depuis le calendrier, les ordonnances ou les fiches médicales
 * pour créer et sélectionner immédiatement un nouveau patient sans changer de page.
 */
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';

export function PatientQuickDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (patient: { id: number; code: string; name: string }) => void;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();

  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [wilayaCode, setWilayaCode] = useState('');

  const valid = lastName.trim().length >= 1 && firstName.trim().length >= 1;

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number; code: string; first_name: string; last_name: string }>('/patients', {
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        sex,
        wilayaCode: wilayaCode ? Number(wilayaCode) : undefined,
      }),
    onSuccess: (res) => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['patients'] });
      void qc.invalidateQueries({ queryKey: ['list', 'patients'] });
      const fullName = `${(res.last_name ?? lastName).toUpperCase()} ${res.first_name ?? firstName}`.trim();
      onSaved?.({
        id: Number(res.id),
        code: res.code ?? `PAT-${res.id}`,
        name: fullName,
      });
      onClose();
      setLastName('');
      setFirstName('');
      setPhone('');
      setBirthDate('');
      setWilayaCode('');
    },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code;
      toast.error(t(`errors.${code ?? 'network'}`));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('list.new')}
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
        <Field label={t('field.lastName')} required>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom de famille" />
        </Field>
        <Field label={t('field.firstName')} required>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
        </Field>
        <Field label={t('field.sex')}>
          <Select
            value={sex}
            onChange={(e) => setSex(e.target.value as 'M' | 'F')}
            options={[
              { value: 'M', label: t('sex.m') },
              { value: 'F', label: t('sex.f') },
            ]}
          />
        </Field>
        <Field label={t('field.birthDate')}>
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label={t('field.phone')}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05/06/07..." />
        </Field>
        <Field label={t('field.wilayaCode')}>
          <Input type="number" min={1} max={58} value={wilayaCode} onChange={(e) => setWilayaCode(e.target.value)} placeholder="1–58" />
        </Field>
      </div>
    </Dialog>
  );
}
