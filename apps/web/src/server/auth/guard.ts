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

/**
 * Résultat d'authentification DÉTAILLÉ — permet de distinguer, dans la réponse HTTP, trois
 * situations que le client doit traiter différemment :
 *   - 'missing'  : aucun jeton (client jamais connecté, ou nettoyé) ;
 *   - 'invalid'  : jeton illisible/expiré (signature, TTL) ;
 *   - 'ended'    : jeton VALIDE mais SESSION FERMÉE côté serveur (déconnexion ailleurs, session
 *                  révoquée par l'admin, mot de passe réinitialisé, compte désactivé, ou base
 *                  réinitialisée). C'est le cas « session interrompue » : l'écran doit se vider et
 *                  renvoyer vers la connexion, sans laisser croire à un simple hoquet réseau.
 */
export type AuthOutcome = { ok: true; user: AuthUser; code?: undefined } | { ok: false; code: 'errors.unauthorized' | 'auth.sessionEnded' };

/**
 * Authentifie la requête ET vérifie que la session est TOUJOURS VIVANTE.
 *
 * Le jeton d'accès porte l'identifiant de session (`sid`) ; il vit quelques minutes seulement, mais
 * il reste cryptographiquement valable jusqu'à son expiration. Sans ce contrôle, une session
 * révoquée (déconnexion depuis un autre appareil, « révoquer les autres sessions », réinitialisation
 * de mot de passe) continuait d'ouvrir le dossier patient jusqu'à 15 minutes : l'utilisateur voyait
 * ses écrans se comporter normalement alors que sa session n'existait plus. On exige donc, à CHAQUE
 * requête authentifiée, que la ligne `sessions` existe, ne soit pas révoquée et ne soit pas expirée.
 *
 * Coût : une lecture par clé primaire (déjà une lecture `users` par requête pour les permissions).
 * La latence de révocation devient immédiate — c'est le prix, assumé, de la justesse ici.
 */
export async function authenticateOutcome(req: Request): Promise<AuthOutcome> {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { ok: false, code: 'errors.unauthorized' };
  const claims = await verifyAccessToken(token);
  if (!claims) return { ok: false, code: 'errors.unauthorized' };

  const db = await getDb();
  /**
   * Session obligatoire. Un jeton sans `sid` (jeton forgé à la main, ancien client) est refusé :
   * il n'est rattaché à aucune session révocable, il ne peut donc pas être invalidé.
   */
  if (claims.sid == null) return { ok: false, code: 'auth.sessionEnded' };
  const session = await db.findOne<Record<string, unknown>>('sessions', { id: claims.sid });
  if (!session) return { ok: false, code: 'auth.sessionEnded' };
  if (session.revoked_at) return { ok: false, code: 'auth.sessionEnded' };
  if (new Date(String(session.expires_at)) < new Date()) return { ok: false, code: 'auth.sessionEnded' };

  const user = await db.findOne<Record<string, unknown>>('users', { id: claims.uid });
  // compte désactivé/supprimé : la session n'a plus lieu d'être — traitée comme interrompue
  if (!user || !Number(user.active)) return { ok: false, code: 'auth.sessionEnded' };
  const roleId = Number(user.role_id);
  const { perms, roleKey } = await permissionsFor(roleId);
  return {
    ok: true,
    user: {
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
    },
  };
}

/** Compatibilité (routes publiques facultativement authentifiées) : utilisateur ou null. */
export async function authenticate(req: Request): Promise<AuthUser | null> {
  const res = await authenticateOutcome(req);
  return res.ok ? res.user : null;
}

export async function requireAuth(req: Request): Promise<AuthUser> {
  const res = await authenticateOutcome(req);
  if (!res.ok) throw new ApiError(401, res.code);
  return res.user;
}

export function requirePerm(user: AuthUser, module: string, action: ActionKey): void {
  if (!can(user.perms, module, action)) throw new ApiError(403, 'errors.forbidden');
}

export function userOrThrow(u: AuthUser | null): AuthUser {
  if (!u) throw new ApiError(401, 'errors.unauthorized');
  return u;
}
