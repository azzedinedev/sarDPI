/**
 * GARDES ANTI-SAUVAGE — le schéma TS est la seule porte d'entrée : une table ou une colonne
 * inconnue est une ERREUR DE PROGRAMMATION, pas une donnée à accepter (anti-injection via config admin,
 * anti-dérive entre adaptateurs). Les adaptateurs JSON l'appliquent aussi : la démo valide le contrat prod.
 */
import { TABLE_BY_NAME, tableMeta } from './schema';

export function assertTable(table: string): void {
  if (!TABLE_BY_NAME.has(table)) throw new Error(`table inconnue (refusée) : ${table}`);
}

export function assertCol(table: string, col: string): void {
  if (!tableMeta(table).cols.has(col)) throw new Error(`colonne inconnue (refusée) : ${table}.${col}`);
}
