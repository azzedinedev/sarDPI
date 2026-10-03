/**
 * Chiffrement AES-256-GCM des champs sensibles AU REPOS (loi 18-07 — art. minimisation / sécurité).
 * Keyring à identifiants pour la ROTATION : ENC_KEYS="2:<hex64>,1:<hex64>" — la clé du plus haut id
 * chiffre les nouvelles écritures, toutes les clés déchiffrent (id encodé dans le préfixe du ciphertext).
 * Format : ENCv1.<keyId>.<iv_b64>.<tag_b64>.<ct_b64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config';

interface KeyEntry {
  id: number;
  buf: Buffer;
}
let keys: KeyEntry[] | null = null;

function keyring(): KeyEntry[] {
  if (!keys) {
    keys = env.encKeys
      .filter((k) => /^[0-9a-fA-F]{64}$/.test(k.key))
      .sort((a, b) => b.id - a.id)
      .map((k) => ({ id: k.id, buf: Buffer.from(k.key, 'hex') }));
  }
  return keys;
}

export function cryptoEnabled(): boolean {
  return keyring().length > 0;
}

export function encryptField(plain: string): string | null {
  const ks = keyring();
  if (!ks.length) return null;
  const key = ks[0]!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.buf, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `ENCv1.${key.id}.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

export function decryptField(stored: string): string | null {
  if (!stored || !stored.startsWith('ENCv1.')) return null;
  const parts = stored.split('.');
  if (parts.length !== 5) return null;
  const key = keyring().find((k) => k.id === Number(parts[1]));
  if (!key) return null; // clé révoquée : lecture impossible (à traiter par restauration de backup)
  try {
    const iv = Buffer.from(parts[2]!, 'base64');
    const tag = Buffer.from(parts[3]!, 'base64');
    const ct = Buffer.from(parts[4]!, 'base64');
    const d = createDecipheriv('aes-256-gcm', key.buf, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Valeur chiffrée en base ? (pour masquer dans l'UI/API si besoin) */
export function isEncryptedValue(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('ENCv1.');
}
