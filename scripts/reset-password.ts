/**
 * Outil CLI d'urgence : réinitialise le mot de passe d'un compte (ou le déverrouille) SANS passer
 * par l'e-mail ni par l'interface d'administration — utile quand SMTP n'est pas configuré, quand
 * l'unique compte admin est verrouillé, ou sur une installation on-premise hors-ligne.
 *
 * Usage :
 *   npm run reset:password -- --list                       # liste les comptes (rôle, état, verrou)
 *   npm run reset:password -- admin                        # mot de passe aléatoire + affichage
 *   npm run reset:password -- admin 'Nouveau!Mdp2026'      # mot de passe imposé
 *   npm run reset:password -- admin --unlock               # déverrouille seulement (mot de passe inchangé)
 *   npm run reset:password -- admin --no-force             # pas de changement forcé à la 1re connexion
 *   npm run reset:password -- admin --keep-sessions        # ne déconnecte pas les autres appareils
 *
 * Par défaut, TOUTES les sessions du compte sont révoquées (une réinitialisation coupe l'accès
 * partout, comme le flux « mot de passe oublié ») et `must_change_password` est armé, sauf si le
 * mot de passe est fourni explicitement — dans ce cas l'utilisateur est quand même invité à le
 * changer à la prochaine connexion, conformément à la politique de l'application.
 *
 * Chaque réinitialisation est inscrite dans le journal d'audit chaîné (action
 * `users.reset_password_cli`, acteur = NULL car hors session).
 */
/* eslint-disable no-console */
import { randomInt } from 'node:crypto';

const FORCE_CHANGE_DEFAULT = true;
const SYMBOLS = '!@#$%&*+-=?';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';

/** Mot de passe conforme à la politique (≥10, majuscule, chiffre, symbole) — 16 caractères, sans ambiguïté 0/O/1/l/I. */
function generatePassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [UPPER[randomInt(UPPER.length)]!, LOWER[randomInt(LOWER.length)]!, DIGITS[randomInt(DIGITS.length)]!, SYMBOLS[randomInt(SYMBOLS.length)]!];
  while (chars.length < length) chars.push(all[randomInt(all.length)]!);
  // Mélange de Fisher-Yates : les 4 caractères imposés ne restent pas en tête.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  // Premier caractère toujours alphanumérique : un mot de passe commençant par « - » ou « = » est
  // pénible à recopier depuis un terminal (option, affectation shell).
  if (SYMBOLS.includes(chars[0]!)) {
    const k = 4 + randomInt(chars.length - 4);
    [chars[0], chars[k]] = [chars[k]!, chars[0]!];
  }
  return chars.join('');
}

function usage(): void {
  console.log(`Utilisation : npm run reset:password -- <identifiant|e-mail> [nouveau-mot-de-passe] [options]

Options :
  --list             liste les comptes (aucune modification)
  --unlock           déverrouille le compte sans changer le mot de passe
  --random           force la génération d'un mot de passe aléatoire
  --no-force         ne force pas le changement à la prochaine connexion
  --keep-sessions    conserve les sessions actives (par défaut elles sont révoquées)
  -h, --help         affiche cette aide

Exemples :
  npm run reset:password -- admin
  npm run reset:password -- dr.merabet 'Medecin!2026-dz' --no-force
  npm run reset:password -- admin --unlock`);
}

async function main(): Promise<void> {
  process.env.SARDPI_SCRIPT = '1';
  const argv = process.argv.slice(2);
  const has = (f: string): boolean => argv.includes(f);
  const positional = argv.filter((a) => !a.startsWith('-'));

  if (has('-h') || has('--help')) {
    usage();
    return;
  }

  const { getDb, effectiveConfig } = await import('../apps/web/src/server/data');
  const { hashPassword, checkPolicy } = await import('../apps/web/src/server/auth/password');
  const { audit } = await import('../apps/web/src/server/audit');

  const cfg = effectiveConfig();
  const db = await getDb();

  /* ------------------------------------------------------------------ --list */
  if (has('--list')) {
    const users = await db.find<Record<string, unknown>>('users', { orderBy: [['id', 'asc']] });
    const roles = await db.find<Record<string, unknown>>('roles', {});
    const roleName = new Map(roles.map((r) => [Number(r.id), String(r.role_key)]));
    if (!users.length) console.log('Aucun compte en base — lancez « npm run seed » (démo) ou créez un administrateur.');
    for (const u of users) {
      const lock = u.locked_until && new Date(String(u.locked_until)) > new Date() ? `VERROUILLÉ jusqu'à ${new Date(String(u.locked_until)).toLocaleString('fr-CA')}` : 'ok';
      const forced = Number(u.must_change_password) === 1 ? ' · changement forcé' : '';
      console.log(`- ${String(u.username).padEnd(16)} ${String(u.email).padEnd(26)} rôle=${(roleName.get(Number(u.role_id)) ?? '?').padEnd(11)} ${Number(u.active) ? 'actif' : 'DÉSACTIVÉ'} · ${lock}${forced}`);
    }
    console.log(`\nAdaptateur : ${cfg.adapter}${cfg.adapter === 'json' || cfg.adapter === 'memory' ? ' (mode démo)' : ''}`);
    await db.close();
    return;
  }

  /* ------------------------------------------------------------- résolution */
  const identifier = positional[0]?.trim();
  if (!identifier) {
    usage();
    process.exitCode = 1;
    await db.close();
    return;
  }
  const user =
    (await db.findOne<Record<string, unknown>>('users', { username: identifier })) ??
    (await db.findOne<Record<string, unknown>>('users', { email: identifier }));
  if (!user) {
    console.error(`✖ Aucun compte « ${identifier} » (ni nom d'utilisateur ni e-mail). Essayez : npm run reset:password -- --list`);
    process.exitCode = 1;
    await db.close();
    return;
  }
  const userId = Number(user.id);
  const label = `${String(user.username)} <${String(user.email)}>`;

  /* ---------------------------------------------------------------- --unlock */
  if (has('--unlock')) {
    await db.update('users', userId, { failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
    await audit({ actorId: null, action: 'users.unlock_cli', entity: 'users', entityId: userId, diff: { locked_until: null } });
    console.log(`✓ Compte ${label} déverrouillé (échecs remis à zéro). Le mot de passe est INCHANGÉ.`);
    await db.close();
    return;
  }

  /* ------------------------------------------------------------ mot de passe */
  const explicit = positional[1];
  const random = has('--random') || !explicit;
  const password = random ? generatePassword() : String(explicit);
  const POLICY: Record<string, string> = {
    'password.minLength': 'au moins 10 caractères',
    'password.uppercase': 'au moins une majuscule',
    'password.digit': 'au moins un chiffre',
    'password.symbol': 'au moins un symbole (!@#$%&*+-=?)',
  };
  const policyError = checkPolicy(password);
  if (policyError) {
    console.error(`✖ Mot de passe refusé : ${POLICY[policyError] ?? policyError}.`);
    process.exitCode = 1;
    await db.close();
    return;
  }

  const forceChange = has('--no-force') ? false : FORCE_CHANGE_DEFAULT;
  const now = new Date().toISOString();
  await db.update('users', userId, {
    password_hash: await hashPassword(password),
    must_change_password: forceChange ? 1 : 0,
    failed_attempts: 0,
    locked_until: null,
    updated_at: now,
  });

  /* ------------------------------------------------------------- sessions */
  // Une réinitialisation coupe l'accès partout (comme « mot de passe oublié ») : jetons de rafraîchissement
  // révoqués → la garde de session revalide `sid` à chaque requête et renvoie auth.sessionEnded.
  let revoked = 0;
  if (!has('--keep-sessions')) {
    const sessions = await db.find<{ id: number; revoked_at: unknown }>('sessions', { where: { user_id: userId } });
    revoked = sessions.filter((s) => !s.revoked_at).length;
    if (sessions.length) await db.updateWhere('sessions', { user_id: userId }, { revoked_at: now });
  }

  // La clé « password_hash » n'apparaît jamais dans le diff (redaction automatique du journal) ;
  // on journalise seulement l'effet observable.
  await audit({ actorId: null, action: 'users.reset_password_cli', entity: 'users', entityId: userId, diff: { forced_change: forceChange, sessions_revoked: revoked } });

  console.log(`✓ Mot de passe réinitialisé pour ${label}`);
  console.log(`  Mot de passe : ${password}${random ? '  (généré — notez-le maintenant, il ne sera plus affiché)' : ''}`);
  if (!Number(user.active)) console.log('  ⚠ Ce compte est DÉSACTIVÉ : activez-le (Admin » Utilisateurs) pour autoriser la connexion.');
  if (forceChange) console.log('  Changement demandé à la prochaine connexion (--no-force pour l’éviter).');
  if (revoked) console.log(`  ${revoked} session(s) active(s) révoquée(s) — reconnectez-vous (--keep-sessions pour conserver).`);
  console.log(`  Adaptateur : ${cfg.adapter}${cfg.adapter === 'json' || cfg.adapter === 'memory' ? ' (mode démo — le serveur déjà lancé recharge le fichier à chaud)' : ''}`);
  await db.close();
}

main().catch((err) => {
  console.error('Erreur lors de la réinitialisation du mot de passe :', err);
  process.exit(1);
});
