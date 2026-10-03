/** Liveness — ne dépend de rien (processus vivant). */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, at: new Date().toISOString(), pid: process.pid }, { headers: { 'cache-control': 'no-store' } });
}
