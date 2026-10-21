import type { TriageResponse } from '../types';
import { Card, Row } from './ui';

const ACCENT = {
  refund: 'before:bg-money',
  hold_for_human: 'before:bg-hold',
  none: 'before:bg-faint',
} as const;

const AMOUNT_COLOR = {
  refund: 'text-money',
  hold_for_human: 'text-hold',
  none: 'text-muted',
} as const;

const HEADLINE = {
  refund: 'Refund approved',
  hold_for_human: 'Held for a human',
  none: 'No refund due',
} as const;

/**
 * The money decision, and directly beneath it what the model claimed versus
 * what the gate decided. The second part is the whole architecture in one row:
 * on T-1009 the model says duplicate_charge and the gate pays nothing.
 */
export function DecisionCard({ result }: { result: TriageResponse }) {
  const { refund, claim_type } = result;
  const overruled = refund.decision !== 'refund' && claim_type !== 'no_billing_claim';

  return (
    <Card
      className={`relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-[''] ${ACCENT[refund.decision]}`}
      title="Money decision"
    >
      <div className={`text-[30px] leading-tight font-semibold tracking-tight ${AMOUNT_COLOR[refund.decision]}`}>
        {refund.amount_inr > 0 ? `₹${refund.amount_inr.toLocaleString('en-IN')}` : '₹0'}
      </div>
      <div className="mt-0.5 text-xs text-muted">{HEADLINE[refund.decision]}</div>

      <div className="mt-3 font-mono text-[11px] break-all text-accent">{refund.rule_id}</div>
      <div className="font-mono text-[11px] text-muted">{refund.reason}</div>

      <div className="mt-3.5 flex items-stretch">
        <div className="flex-1 rounded-l-md border border-r-0 border-line bg-raised px-3 py-2">
          <div className="mb-0.5 text-[10px] tracking-[0.07em] text-faint uppercase">
            Model claimed
          </div>
          <div className="font-mono text-xs">{claim_type}</div>
        </div>
        <div className="flex items-center border-y border-line bg-raised px-0.5 text-faint">→</div>
        <div className="flex-1 rounded-r-md border border-l-0 border-line bg-raised px-3 py-2">
          <div className="mb-0.5 text-[10px] tracking-[0.07em] text-faint uppercase">
            Gate decided
          </div>
          <div className="font-mono text-xs">{refund.decision}</div>
        </div>
      </div>

      {overruled && (
        <p className="mt-2 text-xs text-hold">
          The gate read the ledger and did not agree with the claim.
        </p>
      )}

      {Object.keys(refund.basis).length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] tracking-[0.07em] text-faint uppercase">
            What the rule used
          </div>
          {Object.entries(refund.basis).map(([key, value]) => (
            <Row key={key} label={key}>
              {value === null || value === '' ? '—' : String(value)}
            </Row>
          ))}
        </div>
      )}
    </Card>
  );
}
