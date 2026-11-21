import { z } from 'zod';
import { indianMobileSchema } from './phone.js';
import { ROLES } from './rbac.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const fullNameSchema = z.string().trim().min(2).max(120);

/** Public sign-up creates CUSTOMER or OWNER accounts only. */
export const registerSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  phone: indianMobileSchema.optional(),
  accountType: z.enum(['CUSTOMER', 'OWNER']).default('CUSTOMER'),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().default(false),
});
export type LoginInput = z.input<typeof loginSchema>;

export const tokenSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/);

export const verifyEmailSchema = z.strictObject({ token: tokenSchema });

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });

export const resetPasswordSchema = z.strictObject({
  token: tokenSchema,
  password: passwordSchema,
});

export const otpSendSchema = z.strictObject({ phone: indianMobileSchema });

export const otpVerifySchema = z.strictObject({
  phone: indianMobileSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const roleChangeSchema = z.strictObject({ role: z.enum(ROLES) });

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: (typeof ROLES)[number];
  emailVerified: boolean;
  phoneVerified: boolean;
  permissions: string[];
}

export interface AuthSession {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
}
