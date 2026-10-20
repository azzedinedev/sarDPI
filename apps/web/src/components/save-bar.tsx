'use client';
/**
 * BARRE D'ENREGISTREMENT DES ÉCRANS DE RÉGLAGES — extraite de la page Paramètres pour être partagée.
 * ------------------------------------------------------------------------------------------------
 * Même comportement partout : état « à jour / modifications non enregistrées », nombre de champs à
 * corriger (validation déjà faite par le formulaire), bouton « Rétablir » (retour à la version
 * serveur) et « Enregistrer » désactivé tant que la saisie est invalide ou inchangée. Elle se colle
 * en bas de la carte pour rester visible sur un long formulaire.
 *
 * Deux écrans l'utilisent : Paramètres (toutes les sections) et Administration » Vaccination
 * (onglet « Calendrier vaccinal », qui édite le réglage `vaccination` hors de la page Paramètres).
 */
import React from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Badge, Button } from '@/components/ui';

export function SaveBar({
  dirty,
  saving,
  invalidCount = 0,
  disabled = false,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  invalidCount?: number;
  /** lecture seule (droit `update` absent) : les deux boutons sont neutralisés */
  disabled?: boolean;
  onSave: () => void;
  onReset: () => void;
}): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap items-center gap-2 rounded-b-[var(--r-card)] border-t border-[rgb(var(--c-line)/0.7)] bg-[rgb(var(--c-surface)/0.93)] px-4 py-2.5 backdrop-blur">
      <Badge tone={dirty ? 'warn' : 'ok'}>{dirty ? t('settings.save.dirty') : t('settings.save.upToDate')}</Badge>
      {invalidCount > 0 ? <Badge tone="danger">{t('settings.save.invalid', { n: invalidCount })}</Badge> : null}
      <div className="ms-auto flex items-center gap-2">
        <Button onClick={onReset} disabled={disabled || !dirty} title={t('settings.save.discard')}>
          <RotateCcw size={14} /> {t('settings.save.discard')}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={disabled || !dirty || invalidCount > 0}
          title={invalidCount > 0 ? t('settings.save.invalidHint') : undefined}
          onClick={onSave}
        >
          <Save size={14} /> {tc('save')}
        </Button>
      </div>
    </div>
  );
}
