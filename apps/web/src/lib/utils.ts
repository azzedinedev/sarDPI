'use client';
/** concat className sans dépendance externe */
export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

/**
 * Convertit une couleur hexadécimale (#rgb / #rrggbb) en rgba() avec l'alpha demandé.
 * Les étiquettes du calendrier (types/statuts de RDV) sont configurables en base avec une
 * couleur libre : les classes Tailwind pré-générées ne peuvent donc plus les couvrir, d'où
 * des styles en ligne. Toute valeur non reconnue (ex. « rgb(...) ») est renvoyée telle quelle.
 */
export function withAlpha(color: string | null | undefined, alpha: number): string {
  const c = String(color ?? '').trim();
  const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return c || `rgba(100,116,139,${alpha})`;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
