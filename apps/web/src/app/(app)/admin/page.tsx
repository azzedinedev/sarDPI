'use client';
/** Administration — hub des sections (chacune permissionnée, aucune sortie cloud requise). */
import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Blocks, CalendarClock, Database, FolderCog, KeyRound, Languages, Mail, Palette, Plug, Settings2, ShieldCheck, Users } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';

const SECTIONS = [
  { href: '/admin/users', icon: Users, perm: 'user', key: 'admin.users' },
  { href: '/admin/roles', icon: ShieldCheck, perm: 'role', key: 'admin.roles' },
  { href: '/admin/settings', icon: Settings2, perm: 'setting', key: 'admin.settings' },
  { href: '/admin/translations', icon: Languages, perm: 'translation', key: 'admin.translations' },
  { href: '/admin/themes', icon: Palette, perm: 'theme', key: 'admin.themes' },
  { href: '/admin/database', icon: Database, perm: 'setting', key: 'admin.database' },
  { href: '/admin/catalog', icon: Blocks, perm: 'catalog', key: 'admin.catalog' },
  { href: '/admin/system', icon: CalendarClock, perm: 'job', key: 'admin.system' },
  { href: '/admin/sources', icon: Plug, perm: 'externalImport', key: 'admin.sources' },
];

export default function AdminHome(): React.ReactElement {
  const { t } = useT('settings');
  const has = useAuth((s) => s.has);
  const items = SECTIONS.filter((x) => has(x.perm, 'view'));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-[20px] font-bold">
          <FolderCog size={20} className="text-[rgb(var(--c-primary))]" /> {t('admin.title')}
        </h1>
        <p className="mt-1 text-[12.5px] text-[rgb(var(--c-muted))]">{t('admin.subtitle')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((x, i) => (
          <motion.div key={x.href} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}>
            <Link href={x.href} className="glass-card list-card flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgb(var(--c-primary)/0.12)] text-[rgb(var(--c-primary))]">
                <x.icon size={18} />
              </span>
              <span className="text-[14px] font-bold">{t(x.key)}</span>
              <KeyRound size={13} className="ms-auto opacity-30" />
            </Link>
          </motion.div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-[11.5px] text-[rgb(var(--c-muted))]">
        <Mail size={12} /> {t('admin.localOnly')}
      </p>
    </div>
  );
}
