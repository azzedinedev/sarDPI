'use client';
/** concat className sans dépendance externe */
export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}
