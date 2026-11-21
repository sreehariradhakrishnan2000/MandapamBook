export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string };
}
