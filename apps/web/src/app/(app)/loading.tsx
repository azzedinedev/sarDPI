/**
 * Repli de chargement pour tout le groupe applicatif (navigation entre pages, premier rendu).
 * Next.js affiche ce composant pendant que la page se prépare — l'utilisateur voit donc un
 * écran structuré (barre de progression + squelette de la mise en page réelle) au lieu d'un
 * blanc. Les animations respectent la préférence « animations réduites » (.motion-on).
 */
import { PageLoader } from '@/components/loaders';

export default function Loading(): React.ReactElement {
  return <PageLoader />;
}
