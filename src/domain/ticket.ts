import { z } from 'zod';

/**
 * The inbound contract: a ticket exactly as it appears in dhaba_tickets.json.
 *
 * A note on the two enums below. The brief says purchases "are in one of four
 * states: initiated, failed, successful, renewal". The data disagrees: it
 * carries two independent fields, `type` in {trial, renewal} and `status` in
 * {initiated, failed, successful}. "renewal" is a type, not a state. I have
 * modelled what the data does, because the service has to parse the data.
 * Flagged in docs/decisions.md and raised with the team.
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

/** Plan prices, from the brief. Used to sanity-check amounts, never to invent them. */
export const PLAN_PRICES_INR = { trial: 1, monthly: 249, annual: 1499 } as const;
