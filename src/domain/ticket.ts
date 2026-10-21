import { z } from 'zod';

/**
 * A ticket exactly as it appears in dhaba_tickets.json.
 *
 * The brief calls these "four states: initiated, failed, successful, renewal",
 * but the data has two fields: type {trial, renewal} and status {initiated,
 * failed, successful}. Modelled the data. See docs/decisions.md D1.
 */

export const PurchaseType = z.enum(['trial', 'renewal']);
export type PurchaseType = z.infer<typeof PurchaseType>;

export const PurchaseStatus = z.enum(['initiated', 'failed', 'successful']);
export type PurchaseStatus = z.infer<typeof PurchaseStatus>;

export const Purchase = z.object({
  id: z.string().min(1),
  type: PurchaseType,
  amount_inr: z.number().nonnegative(),
  status: PurchaseStatus,
  at: z.iso.datetime({ offset: true }),
});
export type Purchase = z.infer<typeof Purchase>;

export const Ticket = z.object({
  id: z.string().min(1),
  received_at: z.iso.datetime({ offset: true }),
  subject: z.string(),
  body: z.string(),
  purchases: z.array(Purchase),
  app_opens_since_renewal: z.number().int().nonnegative(),
});
export type Ticket = z.infer<typeof Ticket>;

/** From the brief. For sanity checks only -- never to produce a refund amount. */
export const PLAN_PRICES_INR = { trial: 1, monthly: 249, annual: 1499 } as const;
