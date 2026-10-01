/**
 * QR CODES & CODES-BARRES — serveur (identiques en PDF, écran et badge).
 *  - QR : paquet `qrcode` (data URL PNG/SVG, aucune dépendance canvas) ;
 *  - Code128 / DataMatrix : `bwip-js` rendu SVG (utilisé pour le badge patient et les documents) ;
 *  - le contenu encode TOUJOURS le code métier via l'URL de vérification (token signé), jamais un id.
 */
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';

export async function qrSvg(text: string, opts: { dark?: string; light?: string; size?: number } = {}): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: opts.size ?? 96,
    color: { dark: opts.dark ?? '#0f2c3a', light: opts.light ?? '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

export async function qrDataUrl(text: string, size = 96): Promise<string> {
  return QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' });
}

/** Code128 (lisibilité à l'opposée de l'imprimante) ou DataMatrix — sortie SVG. */
export async function barcodeSvg(value: string, format: 'code128' | 'datamatrix' = 'code128'): Promise<string> {
  return bwipjs.toSVG({
    bcid: format === 'code128' ? 'code128' : 'datamatrix',
    text: value.slice(0, 60),
    scale: 2,
    height: format === 'code128' ? 10 : 14,
    includetext: true,
    textxalign: 'center',
    padding: 2,
  });
}

/** URL de vérification publique pour un document (le token est créé côté module). */
export function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/verify/${token}`;
}
