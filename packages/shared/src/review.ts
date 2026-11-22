import { z } from 'zod';

/** Plain text only: trimmed, control characters removed, length-limited. */
const plainText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? c : '')).trim())
    .pipe(z.string().max(max));

export const createReviewSchema = z.strictObject({
  rating: z.number().int().min(1).max(5),
  body: plainText(2000).default(''),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const reviewReplySchema = z.strictObject({ reply: plainText(1000).pipe(z.string().min(1)) });

export const moderateReviewSchema = z.strictObject({
  status: z.enum(['PUBLISHED', 'HIDDEN']),
  reason: plainText(500).pipe(z.string().min(3)),
});

export const reviewListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const adminReviewQuerySchema = reviewListQuerySchema.extend({
  status: z.enum(['PUBLISHED', 'HIDDEN', 'FLAGGED']).optional(),
});

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  /** First name and initial only, e.g. "Priya N." */
  author: string;
  eventMonth: string;
  createdAt: string;
  ownerReply: string | null;
}

/** "Priya Nair" → "Priya N." so public reviews never show a full name. */
export function reviewerDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? 'Guest';
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}
