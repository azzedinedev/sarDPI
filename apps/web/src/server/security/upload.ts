/**
 * SÉCURITÉ UPLOADS — vérification par MAGIC BYTES (le type MIME déclaré par le client est ignoré),
 * taille max, nom nettoyé. ClamAV : hook optionnel (scan du fichier en base avant diffusion) documenté, non bloquant.
 */
export interface SniffedFile {
  mime: string;
  ext: string;
}

function starts(buf: Buffer, sig: number[], at = 0): boolean {
  if (buf.length < at + sig.length) return false;
  return sig.every((v, i) => buf[at + i] === v);
}

export function sniffFile(buf: Buffer): SniffedFile | null {
  if (starts(buf, [0x25, 0x50, 0x44, 0x46])) return { mime: 'application/pdf', ext: 'pdf' };
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', ext: 'png' };
  if (starts(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts(buf, [0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', ext: 'gif' };
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && buf.length > 12 && starts(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp' };
  if (starts(buf, [0x49, 0x49, 0x2a, 0x00]) || starts(buf, [0x4d, 0x4d, 0x00, 0x2a])) return { mime: 'image/tiff', ext: 'tif' };
  // DICOM (préfixé 'DICM' à l'offset 128) : refusé pour l'instant — viewer à la phase ultérieure.
  if (buf.length > 132 && starts(buf, [0x44, 0x49, 0x43, 0x4d], 128)) return null;
  return null;
}

export const ALLOWED_UPLOAD: { mime: string; ext: string; label: string }[] = [
  { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
  { mime: 'image/png', ext: 'png', label: 'PNG' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  { mime: 'image/gif', ext: 'gif', label: 'GIF' },
  { mime: 'image/webp', ext: 'webp', label: 'WEBP' },
  { mime: 'image/tiff', ext: 'tif', label: 'TIFF (imagerie)' },
];
