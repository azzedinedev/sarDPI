'use client';

/**
 * GedUploadButton — bouton « Ajouter un document » + modale de téléversement GED.
 * Auto-porteur : gère son propre état d'ouverture. Accepte patientId (requis) et,
 * optionnellement, caseId (dossier) / recordId (fiche) pour lier le document.
 */
import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button, Field, Input, Select } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';

export function GedUploadButton({
  pid,
  caseId,
  recordId,
  onDone,
  label,
  variant = 'primary',
}: {
  pid: number;
  caseId?: number | null;
  recordId?: number | null;
  onDone?: () => void;
  label?: string;
  variant?: 'primary' | 'ghost';
}): React.ReactElement {
  const { t } = useT('patient');
  const { t: tc } = useT('common');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('DOC');
  const [file, setFile] = useState<File | null>(null);
  const types = useQuery({ queryKey: ['ged-types'], queryFn: () => api.get<{ rows: { prefix: string; label: string }[] }>('/ged/meta/types'), enabled: open });

  const up = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('typePrefix', type);
      fd.set('title', title || (file?.name ?? 'Document'));
      fd.set('patientId', String(pid));
      if (caseId != null) fd.set('caseId', String(caseId));
      if (recordId != null) fd.set('recordId', String(recordId));
      if (file) fd.set('file', file);
      return api.upload<{ row: { code: string } }>('/ged/upload', fd);
    },
    onSuccess: () => {
      toast.success(tc('saved'));
      setOpen(false);
      setFile(null);
      setTitle('');
      onDone?.();
    },
    onError: () => toast.error(t('ged.uploadError')),
  });

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Upload size={14} /> {label ?? t('ged.upload')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={label ?? t('ged.upload')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            <Button variant="primary" loading={up.isPending} disabled={!file} onClick={() => up.mutate()}>{tc('save')}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('ged.type')}>
            <Select value={type} onChange={(e) => setType(e.target.value)} options={(types.data?.rows ?? []).map((x) => ({ value: x.prefix, label: `${x.prefix} — ${x.label}` }))} />
          </Field>
          <Field label={tc('title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name} />
          </Field>
          <Field label={tc('file')} required>
            <input type="file" className="field" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
