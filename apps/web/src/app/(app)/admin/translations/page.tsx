'use client';
/**
 * Éditeur de traductions — par langue × namespace, JSON validé (rejet propre), sauvegarde atomique
 * + invalidation ETag (hot reload sans redémarrage) et rapport des clés manquantes (côté serveur + clients).
 */
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookX, Download, Save, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Badge, Button, Card, Field, Input, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { fmtVal } from '@/components/crud';

export default function TranslationsAdminPage(): React.ReactElement {
  const { t } = useT('settings');
  const { t: tc } = useT('common');
  const toast = useToast();
  const qc = useQueryClient();
  const [lang, setLang] = useState('ar');
  const [ns, setNs] = useState('common');
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['tr-ed', lang, ns], queryFn: () => api.get<Ed>(`/admin/translations?lang=${lang}&ns=${ns}`) });
  const [rows, setRows] = useState<EdRow[]>([]);
  useEffect(() => setRows(q.data?.keys ?? []), [q.data]);

  const missing = useQuery({ queryKey: ['tr-missing'], queryFn: () => api.get<{ report: { key: string; count: number }[]; health: Record<string, unknown> }>('/admin/translations/missing') });

  const save = useMutation({
    mutationFn: (dict: Record<string, string>) => api.put('/admin/translations', { lang, ns, entries: dict }),
    onSuccess: () => {
      toast.success(tc('saved'));
      void qc.invalidateQueries({ queryKey: ['tr-ed'] });
      void qc.invalidateQueries({ queryKey: ['i18n'] });
    },
    onError: () => toast.error(t('translations.invalid')),
  });

  const changed = rows.filter((r) => r._dirty);
  const filtered = rows.filter((r) => !filter || r.key.includes(filter) || String(r[lang]).includes(filter) || r.missing);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[20px] font-bold">{t('admin.translations')}</h1>
          <p className="text-[12.5px] text-[rgb(var(--c-muted))]">{t('translations.subtitle')}</p>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="ms-auto"
          disabled={!changed.length}
          loading={save.isPending}
          onClick={() => {
            const entries: Record<string, string> = {};
            for (const r of changed) entries[r.key] = String(r[lang]);
            save.mutate(entries);
          }}
        >
          <Save size={14} /> {tc('save')} ({changed.length})
        </Button>
      </div>

      {missing.data?.report.length ? (
        <Card className="!p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[rgb(var(--c-amber))]">
            <BookX size={15} /> {t('translations.missing')} ({missing.data.report.length})
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              onClick={() => {
                const blob = new Blob([JSON.stringify(missing.data.report, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'missing-keys.json';
                a.click();
              }}
            >
              <Download size={12} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void api.post('/admin/translations/missing/clear', {}).then(() => qc.invalidateQueries({ queryKey: ['tr-missing'] }))}>
              {tc('clear')}
            </Button>
          </div>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {missing.data.report.slice(0, 80).map((m) => (
              <Badge key={m.key} tone="warn" className="font-mono !text-[10.5px]">
                {m.key} ×{m.count}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="glass-card flex flex-wrap items-center gap-2 !p-2">
        <Field label={tc('lang')}>
          <Select value={lang} onChange={(e) => setLang(e.target.value)} options={(q.data?.languages ?? [{ code: 'fr', name: 'Français' }, { code: 'ar', name: 'العربية' }]).map((l) => ({ value: l.code, label: l.name }))} />
        </Field>
        <Field label="namespace">
          <Select value={ns} onChange={(e) => setNs(e.target.value)} options={(q.data?.namespaces ?? ['common']).map((x) => ({ value: x, label: x }))} />
        </Field>
        <div className="relative ms-auto min-w-[200px] flex-1 max-w-xs">
          <Search size={13} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[rgb(var(--c-muted))] ltr:left-2.5 rtl:right-2.5" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('translations.filter')} className="!min-h-9 ps-8" />
        </div>
      </div>

      <Card className="!p-0">
        {q.isLoading ? (
          <div className="flex flex-col gap-1 p-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="dt-table">
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} className={r.missing ? 'bg-[rgb(var(--c-amber-soft)/0.35)]' : undefined}>
                    <td dir="ltr" className="w-1/3 break-all align-top font-mono text-[11.5px]">
                      {r.key}
                      {r.missing ? <AlertTriangle size={11} className="ms-1 inline text-[rgb(var(--c-amber))]" /> : null}
                    </td>
                    <td className="w-1/2 p-1">
                      <input
                        className="field !min-h-8 !border-transparent !bg-transparent !py-1 text-[13px] hover:!border-[rgb(var(--c-line))]"
                        value={String(r[lang] ?? '')}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, [lang]: e.target.value, _dirty: true } : x)))
                        }
                      />
                    </td>
                    <td dir={lang === 'ar' ? 'rtl' : 'ltr'} className="w-1/6 truncate text-end text-[11.5px] text-[rgb(var(--c-muted))]" title={String(r.fr ?? '')}>
                      {lang !== 'fr' ? fmtVal(r.fr) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

interface EdRow {
  key: string;
  missing: boolean;
  fr?: string;
  _dirty?: boolean;
  [lang: string]: unknown;
}
interface Ed {
  lang: string;
  ns: string;
  keys: EdRow[];
  namespaces: string[];
  languages: { code: string; name: string }[];
}
