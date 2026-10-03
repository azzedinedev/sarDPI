/**
 * Logs structurés (pino) avec identifiant de corrélation.
 * Règle stricte : JAMAIS de données médicales nominatives dans les logs (seules des ids/codes sont loggés).
 */
import pino from 'pino';

let _logger: pino.Logger | null = null;

export function createLogger(level?: string): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level: level ?? (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')),
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token', '*.refreshToken', '*.totp'], censor: '•' },
    });
  }
  return _logger;
}

export type Log = pino.Logger;

/** Crée un sous-logger porteur de l'identifiant de corrélation d'une requête. */
export function childLog(requestId?: string): pino.Logger {
  return createLogger().child(requestId ? { rid: requestId } : {});
}
