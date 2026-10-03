import { redirect } from 'next/navigation';

/** Point d'entrée : vers le tableau de bord (le shell gère l'anon → /login). */
export default function Home(): React.ReactElement {
  redirect('/dashboard');
}
