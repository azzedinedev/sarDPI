/** Erreurs d'API uniformes — code i18n + détails, jamais de stack trace côté client en prod. */
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new ApiError(404, 'errors.notFound');
export const forbidden = (msg?: string) => new ApiError(403, 'errors.forbidden', msg);
export const conflict = (msg?: string) => new ApiError(409, 'errors.conflict', msg);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, 'errors.validation', msg, details);

export function zodDetails(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const path = issue.path.join('.') || '_';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

export function errorResponse(err: unknown, rid: string, isProd: boolean): Response {
  if (err instanceof ApiError) {
    return Response.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null, rid } },
      { status: err.status, headers: { 'cache-control': 'private, no-store', 'x-request-id': rid } },
    );
  }
  if (err instanceof ZodError) {
    return Response.json(
      { error: { code: 'errors.validation', message: 'validation', details: zodDetails(err), rid } },
      { status: 422, headers: { 'cache-control': 'private, no-store', 'x-request-id': rid } },
    );
  }
  const message = isProd ? 'internal error' : (err as Error)?.message ?? 'error';
  return Response.json(
    { error: { code: 'errors.server', message, details: null, rid } },
    { status: 500, headers: { 'cache-control': 'private, no-store', 'x-request-id': rid } },
  );
}
