import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import { getDb } from '@/server/data';
import { sha256 } from '@/server/util';
import { SESSION_COOKIE, loginUrl } from '@/lib/session-gate';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Récupère l'URL demandée pour le paramètre ?next=
  const h = await headers();
  const rawPath = h.get('x-matched-path') || h.get('x-invoke-path') || '/dashboard';
  const path = rawPath.startsWith('/') ? rawPath : '/dashboard';

  if (!token) {
    redirect(loginUrl(path, 'expired'));
  }

  try {
    const db = await getDb();
    const hash = sha256(token);
    const sess = await db.findOne<Record<string, unknown>>('sessions', { refresh_hash: hash });
    if (!sess || sess.revoked_at || new Date(String(sess.expires_at)) < new Date()) {
      redirect(loginUrl(path, 'expired'));
    }
    const user = await db.findOne<Record<string, unknown>>('users', { id: Number(sess.user_id) });
    if (!user || !Number(user.active)) {
      redirect(loginUrl(path, 'expired'));
    }
  } catch (err: unknown) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    
    redirect(loginUrl(path, 'expired'));
  }

  return <Shell>{children}</Shell>;
}
