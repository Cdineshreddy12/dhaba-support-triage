export type Severity = 'p0' | 'p1' | 'p2' | 'p3';
export type PurchaseStatus = 'initiated' | 'failed' | 'successful';

export interface Purchase {
  id: string;
  type: 'trial' | 'renewal';
  amount_inr: number;
  status: PurchaseStatus;
  at: string;
}

export interface Ticket {
  id: string;
  received_at: string;
  subject: string;
  body: string;
  purchases: Purchase[];
  app_opens_since_renewal: number;
}

export interface RefundResult {
  decision: 'none' | 'refund' | 'hold_for_human';
  amount_inr: number;
  currency: 'INR';
  reason: string;
  rule_id: string;
  requires_human: boolean;
  basis: Record<string, string | number | boolean | null>;
}

export interface Escalation {
  code: string;
  severity_floor: Severity;
  requires_human: boolean;
}

export interface TriageResponse {
  ticket_id: string;
  category: string;
  severity: Severity;
  claim_type: string;
  refund: RefundResult;
  reply_draft: string;
  language: string;
  needs_human: boolean;
  confidence: number;
  summary: string;
  flags: {
    prompt_injection_suspected: boolean;
    entitlement_lapsed: boolean;
    claimed_charge_never_captured: boolean;
  };
  escalations: Escalation[];
  meta: {
    mode: 'live' | 'replay' | 'rules_only';
    degraded: string;
    model_attempts: number;
    idempotent_replay: boolean;
    decided_at: string;
  };
}
