/**
 * Outil CLI d'urgence : réinitialise le système de captcha à 'internal' (ou 'none')
 * directement en base, sans nécessiter d'être connecté à l'interface d'administration.
 *
 * Usage :
 *   npm run reset:captcha                  # remet à 'internal' en mode 'math' (addition simple)
 *   npm run reset:captcha internal image   # remet à 'internal' en mode 'image' (caractères déformés)
 *   npm run reset:captcha none             # désactive complètement le captcha
 */
import { getDb } from '../apps/web/src/server/data';
import { saveSection } from '../apps/web/src/server/settings';
import { cacheDel } from '../apps/web/src/server/cache';

async function main(): Promise<void> {
  const provider = (process.argv[2] ?? 'internal').toLowerCase();
  const mode = (process.argv[3] ?? 'math').toLowerCase();

  const allowedProviders = ['none', 'internal', 'turnstile', 'hcaptcha', 'recaptcha'];
  const allowedModes = ['math', 'image'];

  if (!allowedProviders.includes(provider)) {
    console.error(`Fournisseur invalide : "${provider}". Choix : ${allowedProviders.join(', ')}`);
    process.exit(1);
  }
  if (!allowedModes.includes(mode)) {
    console.error(`Mode invalide : "${mode}". Choix : ${allowedModes.join(', ')}`);
    process.exit(1);
  }

  await getDb();
  await saveSection('captcha', { provider, mode });
  cacheDel('settings', 'settings:captcha');

  console.log(`✓ CAPTCHA réinitialisé avec succès :`);
  console.log(`  - Fournisseur : ${provider}`);
  console.log(`  - Mode        : ${mode}`);
  console.log(`Vous pouvez désormais vous connecter immédiatement sur /login.`);
}

main().catch((err) => {
  console.error('Erreur lors de la réinitialisation du captcha :', err);
  process.exit(1);
});
