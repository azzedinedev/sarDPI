/**
 * ROUTEUR API REST v1 — enregistré sous le catch-all Next `/api/v1/[...path]`.
 * Pourquoi les Route Handlers intégrés plutôt qu'un service Fastify séparé :
 *  - un seul processus à déployer en on-premise (pm2 cluster), aucune configuration CORS/proxy ;
 *  - schémas Zod partagés front/back par imports directs (monorepo) ;
 *  - l'interface reste une API REST versionnée découplée (OpenAPI exposé) : un serveur séparé (NestJS)
 *    peut être branché plus tard sans toucher au frontend.
 * Transverse : id de corrélation, rate limiting, CSRF pour les flux cookie, RBAC + garde licence,
 * erreurs uniformes, `private, no-store` par défaut sur toute réponse authentifiée (jamais de PHI en cache partagé).
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { clientIp, rateLimit } from '../security/ratelimit';
import { authenticateOutcome, type AuthUser } from '../auth/guard';
import { ApiError, errorResponse } from './errors';
import { getDb } from '../data';
import type { DataAdapter } from '../data/types';
import { childLog } from '../logger';
import { env } from '../config';
import { audit } from '../audit';

export interface Ctx {
  req: NextRequest;
  params: Record<string, string>;
  query: URLSearchParams;
  user: AuthUser | null;
  db: DataAdapter;
  rid: string;
  ip: string;
  log: ReturnType<typeof childLog>;
  /** parse + validation Zod du corps */
  body: <S extends { parse: (v: unknown) => any }>(schema: S) => Promise<any>;
  resultId?: number;
}

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** ex. '/patients/:id/records' — segments ':x' capturés */
  path: string;
  /** authentification requise (défaut true) */
  auth?: boolean;
  /** permission RBAC [module, action] */
  perm?: [string, 'view' | 'create' | 'update' | 'delete' | 'archive' | 'export' | 'print' | 'email' | 'pdf' | 'validate'];
  handler: (ctx: Ctx) => Promise<unknown>;
  /** audit : journalise {action, entity} après succès */
  audit?: { action: string; entity: string };
  /** ETag cache HTTP pour les lectures de référentiels (le PHI reste no-store) */
  cacheable?: boolean;
  /** skip rate-limit global (login gère le sien) */
  noRate?: boolean;
  /** désactive la garde CSRF double-submit (routes publiques d'amorçage de session uniquement) */
  csrf?: boolean;
  /** permis même avec licence expirée */
  licenseFree?: boolean;
}

const routes: RouteDef[] = [];

export function route(def: RouteDef): void {
  routes.push(def);
}

export function getRoutes(): RouteDef[] {
  return routes;
}

function match(def: RouteDef, method: string, segments: string[]): Record<string, string> | null {
  if (def.method !== method) return null;
  const parts = def.path.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const s = segments[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
    else if (p !== s) return null;
  }
  return params;
}

export async function handleApi(req: NextRequest, pathAfter: string): Promise<NextResponse> {
  const rid = req.headers.get('x-request-id') ?? randomUUID().slice(0, 13);
  const log = childLog(rid);
  const ip = clientIp(req);
  const method = req.method.toUpperCase();
  const segments = pathAfter.split('?')[0]!.split('/').filter(Boolean);
  const url = new URL(req.url);
  const candidates = routes
    .map((r) => ({ def: r, params: match(r, method, segments) }))
    .filter((x): x is { def: RouteDef; params: Record<string, string> } => x.params !== null);
  // priorité aux routes les plus SPÉCIFIQUES (moins de segments paramétrés) : /appointments/view avant /appointments/:id
  const found = candidates.sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length)[0];

  if (!found) {
    return NextResponse.json({ error: { code: 'errors.notFound', message: `route inconnue /api/v1/${pathAfter}`, rid } }, { status: 404, headers: { 'x-request-id': rid } });
  }
  const { def, params } = found;

  try {
    if (!def.noRate) {
      const rl = rateLimit(`${ip}`, env.rateLimitRpm);
      if (!rl.ok) throw new ApiError(429, 'errors.rateLimited', `retry after ${rl.retryAfterSec}s`);
    }

    // L'authentification distingue « pas de jeton » (401 générique) de « session révoquée/expirée »
    // (auth.sessionEnded) : le client redirige immédiatement vers la connexion dans les deux cas,
    // mais l'écran peut expliquer pourquoi la session a été interrompue.
    const auth = await authenticateOutcome(req);
    const user = auth.ok ? auth.user : null;
    if (def.auth !== false && !auth.ok) throw new ApiError(401, auth.code);
    if (def.perm && user) {
      const { can } = await import('@sardpi/shared');
      if (!can(user.perms, def.perm[0], def.perm[1])) throw new ApiError(403, 'errors.forbidden');
    }

    // CSRF (uniquement pour les flux s'appuyant sur les cookies ; Bearer ⇒ exempt).
    // Le client renvoie dans x-csrf-token la valeur du cookie sardpi_csrf (double-submit,
    // cookie non HttpOnly par conception). La garde n'a de sens qu'une fois le cookie posé :
    // les routes d'amorçage (login/refresh/forgot/reset) qui le posent pour la 1re fois sont exemptes.
    if (def.csrf !== false && method !== 'GET' && method !== 'HEAD' && !req.headers.get('authorization')) {
      const cookie = req.cookies.get('sardpi_csrf')?.value;
      if (cookie) {
        const header = req.headers.get('x-csrf-token');
        if (cookie !== header) throw new ApiError(403, 'errors.csrf');
      }
    }

    // Garde licence (admin > Licence ; trial = toujours OK, expiré = bloqué hors licence/auth)
    if (!def.licenseFree) {
      const { getSection } = await import('../settings');
      const lic = (await getSection('license')) as { state?: string };
      if (lic.state === 'expired' || lic.state === 'invalid') throw new ApiError(402, 'errors.licenseRequired');
    }

    const db = await getDb();
    const ctx: Ctx = {
      req,
      params,
      query: url.searchParams,
      user,
      db,
      rid,
      ip,
      log,
      body: async (schema) => {
        const raw = await req.json().catch(() => {
          throw new ApiError(400, 'errors.validation', 'JSON invalide');
        });
        return schema.parse(raw);
      },
    };

    let result = await def.handler(ctx);

    if (def.audit) {
      await audit({ actorId: user?.uid ?? null, action: def.audit.action, entity: def.audit.entity, entityId: ctx.resultId ?? (params.id ? Number(params.id) : null), ip, ua: req.headers.get('user-agent'), diff: null });
    }

    if (result instanceof Response) {
      return result as unknown as NextResponse;
    }
    const resp = NextResponse.json(result ?? { ok: true });
    applyCommonHeaders(resp, req, rid, def, user);
    return resp;
  } catch (e) {
    log.warn({ err: (e as Error).message, path: pathAfter }, 'erreur api');
    const resp = errorResponse(e, rid, env.isProd) as NextResponse;
    resp.headers.set('x-request-id', rid);
    return resp;
  }
}

function applyCommonHeaders(resp: NextResponse, req: NextRequest, rid: string, def: RouteDef, user: AuthUser | null): void {
  resp.headers.set('x-request-id', rid);
  if (def.method === 'GET') {
    if (def.cacheable && !user) {
      resp.headers.set('cache-control', 'public, max-age=60, stale-while-revalidate=300');
    } else {
      // Aucune donnée médicale nominative dans un cache partagé (CDN) : privé, no-store + ETag léger
      resp.headers.set('cache-control', 'private, no-store');
    }
  } else {
    resp.headers.set('cache-control', 'private, no-store');
  }
}

/** Export OpenAPI minimal généré depuis la table de routes (admin > API). */
export function openApiJson(): object {
  return {
    openapi: '3.1.0',
    info: { title: 'sarDPI API', version: '1.0.0', description: 'API REST du dossier patient — authentification Bearer JWT + refresh cookie.' },
    paths: Object.fromEntries(
      routes.reduce<Map<string, Record<string, unknown>>>((m, r) => {
        const p = '/api/v1' + r.path;
        const op = {
          tags: [r.path.split('/')[1] ?? 'misc'],
          security: r.auth === false ? [] : [{ bearerAuth: [] }],
          'x-permission': r.perm ? `${r.perm[0]}.${r.perm[1]}` : undefined,
          responses: { '200': { description: 'OK' } },
        };
        m.set(p, { ...(m.get(p) ?? {}), [r.method.toLowerCase()]: op });
        return m;
      }, new Map())
        .entries(),
    ),
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  };
}
