import { type RequestHandler, Router } from 'express';
import type { Db } from '../../db/client.js';
import type { FieldCrypto } from '../../lib/field-crypto.js';
import type { ObjectStorage } from '../../infra/storage.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { PaymentService } from '../payments/payment.service.js';
import { bookingsInboxRouter } from './bookings-inbox.routes.js';
import { calendarRouter } from './calendar.routes.js';
import { listingsRouter } from './listings.routes.js';
import { mediaRouter } from './media.routes.js';
import { profileRouter } from './profile.routes.js';
import { ScopedResources } from './scoped.js';
import { staffRouter } from './staff.routes.js';

export interface OwnerRouterDeps {
  db: Db;
  authenticate: RequestHandler;
  audit: AuditService;
  auth: AuthService;
  crypto: FieldCrypto;
  storage: ObjectStorage;
  payments: PaymentService;
}

/**
 * Owner-side API. Every route requires a permission and loads resources through
 * ScopedResources, so an owner or staff member can only reach their own venues.
 */
export function ownerRouter(deps: OwnerRouterDeps): Router {
  const { db, authenticate, audit, auth, crypto, storage } = deps;
  const scoped = new ScopedResources(db);
  const r = Router();
  r.use(authenticate);
  r.use(profileRouter({ db, crypto, audit }));
  r.use(listingsRouter({ db, scoped, audit, storage }));
  r.use(calendarRouter({ db, scoped, audit }));
  r.use(mediaRouter({ db, scoped, storage, audit }));
  r.use(staffRouter({ db, scoped, auth, audit }));
  r.use(bookingsInboxRouter({ db, scoped, audit, payments: deps.payments }));
  return r;
}
