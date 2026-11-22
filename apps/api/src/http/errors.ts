export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string };
}

export const errors = {
  unauthenticated: (message = 'Sign in to continue') =>
    new HttpError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: () =>
    new HttpError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect'),
  forbidden: (message = 'You do not have access to this action') =>
    new HttpError(403, 'FORBIDDEN', message),
  /** Used for resources outside the caller's scope, so their existence is not revealed. */
  notFound: (message = 'Resource not found') => new HttpError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string) => new HttpError(409, code, message),
  tooManyRequests: (retryAfterSeconds: number) =>
    new HttpError(
      429,
      'TOO_MANY_REQUESTS',
      `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
      undefined,
      { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    ),
  csrf: () =>
    new HttpError(403, 'CSRF_FAILED', 'Your session check failed. Refresh the page and try again.'),
  badRequest: (code: string, message: string) => new HttpError(400, code, message),
};
