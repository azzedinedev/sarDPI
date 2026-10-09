'use client';

/**
 * PractitionerQuickDialog — modal de création rapide d'un praticien / soignant.
 * Utilisable directement depuis le calendrier ou les fiches pour ajouter et sélectionner
 * immédiatement un intervenant médical.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';

export function PractitionerQuickDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (pract: { id: number; code: string; name: string }) => void;
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();

  const [typePrefix, setTypePrefix] = useState('MED');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [phone, setPhone] = useState('');
  const [speciality, setSpeciality] = useState('');
  const [orderNumber, setOrderNumber] = useState('');

  const typesQuery = useQuery({
    queryKey: ['practitioner-types'],
    queryFn: () => api.get<{ types: { prefix: string; label: Record<string, string> }[] }>('/practitioners/meta/types'),
    enabled: open,
  });
  const typeOptions = (typesQuery.data?.types ?? [
    { prefix: 'MED', label: { fr: 'Médecin' } },
    { prefix: 'INF', label: { fr: 'Infirmier' } },
    { prefix: 'BIO', label: { fr: 'Biologiste' } },
    { prefix: 'RAD', label: { fr: 'Radiologue' } },
  ]).map((x) => ({
    value: x.prefix,
    label: `${x.prefix} — ${x.label?.fr ?? x.prefix}`,
  }));

  const valid = lastName.trim().length >= 1 && firstName.trim().length >= 1;

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number; code: string; first_name: string; last_name: string }>('/practitioners', {
        typePrefix,
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        phone: phone.trim() || undefined,
        orderNumber: orderNumber.trim() || undefined,
        speciality: speciality.trim() ? { fr: speciality.trim() } : undefined,
        active: true,
      }),
    onSuccess: (res) => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['pract-lite'] });
      void qc.invalidateQueries({ queryKey: ['practitioners'] });
      void qc.invalidateQueries({ queryKey: ['list', 'practitioners'] });
      const fullName = `Dr ${res.last_name ?? lastName} ${res.first_name ?? firstName}`.trim();
      onSaved?.({
        id: Number(res.id),
        code: res.code ?? `MED-${res.id}`,
        name: fullName,
      });
      onClose();
      setLastName('');
      setFirstName('');
      setPhone('');
      setSpeciality('');
      setOrderNumber('');
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
      title={t('practitioner.new', { defaultValue: 'Nouveau praticien' })}
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
        <Field label={t('practitioner.type', { defaultValue: 'Type / Préfixe' })} required>
          <Select value={typePrefix} onChange={(e) => setTypePrefix(e.target.value)} options={typeOptions} />
        </Field>
        <Field label={t('field.lastName')} required>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" />
        </Field>
        <Field label={t('field.firstName')} required>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" />
        </Field>
        <Field label={t('practitioner.speciality', { defaultValue: 'Spécialité' })}>
          <Input value={speciality} onChange={(e) => setSpeciality(e.target.value)} placeholder="Médecine générale, Cardiologie..." />
        </Field>
        <Field label={t('field.phone')}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05/06/07..." />
        </Field>
        <Field label={t('practitioner.orderNumber', { defaultValue: 'N° Ordre médical' })}>
          <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Ex: CNOM-12345" />
        </Field>
      </div>
    </Dialog>
  );
}
