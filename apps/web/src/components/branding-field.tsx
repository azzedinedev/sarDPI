'use client';
/**
 * CHAMP « IDENTITÉ VISUELLE » (Paramètres » Général) — téléversement du logo / de l'icône d'onglet.
 * -----------------------------------------------------------------------------------------------
 * Particularité assumée : ce champ n'attend PAS la barre « Enregistrer » du formulaire. Un fichier
 * n'est pas une valeur de réglage sérialisable (il vit dans `storage/branding/`, la base ne garde que
 * son chemin + son empreinte) ; le téléversement est donc immédiat, audité (`branding.upload`) et
 * l'aperçu est mis à jour dans la foulée. Le formulaire voisin (nom de l'application, organisation)
 * conserve, lui, son cycle de saisie/enregistrement habituel — les deux états ne se mélangent pas.
 *
 * Sécurité : le type est vérifié ici pour un refus immédiat, puis REVÉRIFIÉ côté serveur par magic
 * bytes (le mime déclaré par le navigateur ne fait jamais foi) ; le SVG est assaini à l'écriture.
 */
import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button } from '@/components/ui';
import { Dialog } from '@/components/dialogs';
import { useToast } from '@/components/toast';
import { useAuth } from '@/stores/auth';
import { AppLogo } from '@/components/app-logo';
import { applyFavicon, BRANDING_ACCEPT, BRANDING_MAX_BYTES, checkBrandingFile, type BrandingKind } from '@/lib/branding-shared';

interface BrandingImageInfo {
  kind: BrandingKind;
  path: string;
  rev: string;
  mime: string;
  sizeBytes: number;
  url: string;
}
interface BrandingInfo {
  appName: string;
  orgName: string;
  logo: BrandingImageInfo | null;
  favicon: BrandingImageInfo | null;
}

const RECOMMENDED: Record<BrandingKind, string> = {
  logo: 'PNG / SVG / WEBP — 512×512 px conseillé, fond transparent',
  favicon: 'PNG / SVG — 64×64 px ou 128×128 px, carré',
};

export function BrandingField({ kind }: { kind: BrandingKind }): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const has = useAuth((s) => s.has);
  const canEdit = has('setting', 'update');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** prévisualisation locale (immédiate) — remplacée par l'URL serveur dès la réponse */
  const [preview, setPreview] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['branding'], queryFn: () => api.get<BrandingInfo>('/admin/branding') });
  const image = kind === 'logo' ? q.data?.logo ?? null : q.data?.favicon ?? null;
  const src = preview ?? image?.url ?? null;

  const refresh = (info: BrandingInfo | undefined): void => {
    void qc.invalidateQueries({ queryKey: ['branding'] });
    if (kind === 'favicon') applyFavicon(info?.favicon?.url ?? null);
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<{ ok: boolean; branding: BrandingInfo }>(`/admin/branding/${kind}`, form);
    },
    onSuccess: (res) => {
      setPreview(null);
      toast.success(t('settings.branding.uploaded'));
      refresh(res?.branding);
    },
    onError: (e: unknown) => {
      setPreview(null);
      const x = e as { code?: string; status?: number };
      const mb = Math.max(1, Math.round(BRANDING_MAX_BYTES[kind] / 1024 / 1024));
      toast.error(
        x.code === 'errors.badFileType'
          ? t('settings.branding.badType')
          : x.code === 'errors.uploadTooLarge'
            ? t('settings.branding.tooLarge', { mb })
            : tc(`errors.${x.code ?? 'errors.server'}`),
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del<{ ok: boolean; branding: BrandingInfo }>(`/admin/branding/${kind}`),
    onSuccess: (res) => {
      setConfirmClear(false);
      setPreview(null);
      toast.success(t('settings.branding.removed'));
      refresh(res?.branding);
    },
    onError: () => {
      setConfirmClear(false);
      toast.error(tc('errors.errors.server'));
    },
  });

  const pick = (file: File | null | undefined): void => {
    if (!file) return;
    const issue = checkBrandingFile(kind, file);
    if (issue === 'tooLarge') {
      toast.error(t('settings.branding.tooLarge', { mb: Math.round(BRANDING_MAX_BYTES[kind] / 1024 / 1024) }));
      return;
    }
    if (issue) {
      toast.error(t('settings.branding.badType'));
      return;
    }
    if (typeof URL !== 'undefined') {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
    }
    upload.mutate(file);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface)/0.5)] p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface-2))] p-1.5">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-full w-full object-contain" />
          ) : kind === 'logo' ? (
            <AppLogo size={44} boxClassName="rounded-xl" />
          ) : (
            <ImageIcon size={20} className="text-[rgb(var(--c-muted))]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">{t(`settings.branding.${kind}`)}</p>
          <p className="text-[11.5px] text-[rgb(var(--c-muted))]">{t(`settings.branding.${kind}.hint`)}</p>
          <p className="mt-0.5 text-[11px] text-[rgb(var(--c-muted))]">{RECOMMENDED[kind]}</p>
          {image ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge tone="ok">
                <CheckCircle2 size={11} /> {t('settings.branding.inUse')}
              </Badge>
              <span className="font-mono text-[rgb(var(--c-muted))]">{image.mime}</span>
              <span className="tabular-nums text-[rgb(var(--c-muted))]">{Math.max(1, Math.round(image.sizeBytes / 1024))} Ko</span>
            </p>
          ) : (
            <p className="mt-1">
              <Badge>{t('settings.branding.default')}</Badge>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={BRANDING_ACCEPT}
          className="sr-only"
          aria-label={t(`settings.branding.${kind}`)}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant={image ? 'ghost' : 'primary'} disabled={!canEdit || upload.isPending} onClick={() => inputRef.current?.click()}>
          {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {image ? t('settings.branding.replace') : t('settings.branding.choose')}
        </Button>
        {image ? (
          <Button size="sm" variant="ghost" disabled={!canEdit || remove.isPending} onClick={() => setConfirmClear(true)}>
            {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {t('settings.branding.remove')}
          </Button>
        ) : null}
        {!canEdit ? <span className="text-[11.5px] text-[rgb(var(--c-muted))]">{t('settings.branding.readOnly')}</span> : null}
      </div>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('settings.branding.removeTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmClear(false)}>{tc('cancel')}</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 size={14} /> {t('settings.branding.remove')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px]">{t('settings.branding.removeHint')}</p>
      </Dialog>
    </div>
  );
}
