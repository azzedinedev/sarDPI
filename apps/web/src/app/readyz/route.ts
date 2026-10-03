/** Readiness — base de données + stockage + (SMTP optionnel, hors chemin critique). */
import { dbPing } from '@/server/data';
import { paths } from '@/server/config';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await dbPing();
  const storageOk = (() => {
    try {
      fs.mkdirSync(paths.storage, { recursive: true });
      return true;
    } catch {
      return false;
    }
  })();
  const ok = db.ok && storageOk;
  return Response.json(
    { ok, db: { ok: db.ok, adapter: db.adapter, ms: db.ms, demo: db.demo, error: db.error ?? null }, storage: { ok: storageOk } },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
