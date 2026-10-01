/**
 * GARDES CÔTÉ SERVEUR — aucune action sensible sans permission vérifiée en base (anti-IDOR).
 *  - authenticate() : Bearer access token → claims + permissions actuelles (cache court, invalidées au changement de rôle) ;
 *  - requirePerm() : 403 si la permission manque ;
 *  - loadScopedPatient() : exemple de contrôle objet par objet — la RESSOURCE est re-vérifiée à chaque accès.
 */
import { getDb } from '../data';
import { verifyAccessToken, type AccessClaims } from './jwt';
import { cached, bumpTag } from '../cache';
import { can, type ActionKey } from '@sardpi/shared';
import { ApiError } from '../http/errors';

export interface AuthUser extends AccessClaims {
  perms: string[];
  roleKey: string;
  roleId: number;
  username: string;
  fullName: string;
  email: string;
  locale: string;
  active: boolean;
  totpEnabled: boolean;
}

async function permissionsFor(roleId: number): Promise<{ perms: string[]; roleKey: string; name: unknown }> {
  return cached('perms', `role:${roleId}`, 60_000, async () => {
    const db = await getDb();
    const role = await db.findOne<{ role_key: string; perms_json: unknown; name_json: unknown }>('roles', { id: roleId });
    const perms = Array.isArray(role?.perms_json) ? (role!.perms_json as string[]) : role?.perms_json ? JSON.parse(String(role.perms_json)) : [];
    return { perms, roleKey: role?.role_key ?? 'user', name: role?.name_json ?? null };
  });
}

export function invalidateRoleCache(): Promise<void> {
  return bumpTag('perms');
}

export async function authenticate(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const db = await getDb();
  const user = await db.findOne<Record<string, unknown>>('users', { id: claims.uid });
  if (!user || !Number(user.active)) return null;
  const roleId = Number(user.role_id);
  const { perms, roleKey } = await permissionsFor(roleId);
  return {
    ...claims,
    perms,
    roleKey,
    roleId,
    username: String(user.username),
    fullName: String(user.full_name ?? ''),
    email: String(user.email ?? ''),
    locale: String(user.locale ?? 'fr'),
    active: true,
    totpEnabled: Boolean(Number(user.totp_enabled)),
  };
}

export async function requireAuth(req: Request): Promise<AuthUser> {
  const u = await authenticate(req);
  if (!u) throw new ApiError(401, 'errors.unauthorized');
  return u;
}

export function requirePerm(user: AuthUser, module: string, action: ActionKey): void {
  if (!can(user.perms, module, action)) throw new ApiError(403, 'errors.forbidden');
}

export function userOrThrow(u: AuthUser | null): AuthUser {
  if (!u) throw new ApiError(401, 'errors.unauthorized');
  return u;
}
