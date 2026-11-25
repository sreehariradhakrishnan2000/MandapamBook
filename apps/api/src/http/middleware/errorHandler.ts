import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError, type ErrorBody } from '../errors.js';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Resource not found'));
};

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const correlationId = String(req.id);
  let status = 500;
  let body: ErrorBody['error'] = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Try again later.',
    correlationId,
  };

  if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code, message: err.message, correlationId };
    if (err.details !== undefined) body.details = err.details;
    if (err.headers) res.set(err.headers);
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_FAILED',
      message: 'The request contains invalid fields',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      correlationId,
    };
  } else if (isBodyParserError(err)) {
    const tooLarge = err.type === 'entity.too.large';
    status = tooLarge ? 413 : 400;
    body = {
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'MALFORMED_BODY',
      message: tooLarge ? 'Request body is too large' : 'Request body could not be parsed',
      correlationId,
    };
  }

  // Planned maintenance and a bookings pause answer with 503 on purpose: not errors to log.
  const planned =
    err instanceof HttpError && (err.code === 'MAINTENANCE' || err.code === 'BOOKINGS_PAUSED');
  if (status >= 500 && !planned) req.log.error({ err }, 'unhandled error');

  res.status(status).json({ error: body } satisfies ErrorBody);
};
