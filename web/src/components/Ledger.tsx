import type { Purchase, Ticket } from '../types';
import { Card } from './ui';

const DOT = {
  successful: 'bg-money',
  failed: 'bg-danger',
  initiated: 'bg-hold',
} as const;

const AMOUNT = {
  successful: 'text-body',
  failed: 'text-faint line-through',
  initiated: 'text-faint line-through',
} as const;

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Billing's view of the account. Struck-through amounts never moved money,
 * which is the distinction the refund rules turn on and the one users get
 * wrong -- a failed attempt and a capture look identical on a bank statement.
 */
export function Ledger({ ticket }: { ticket: Ticket }) {
  const captured = ticket.purchases.filter((p) => p.status === 'successful');
  const total = captured.reduce((sum, p) => sum + p.amount_inr, 0);

  const ordered = [...ticket.purchases].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  return (
    <Card title="Billing ledger">
      {ordered.length === 0 && <p className="text-xs text-faint">No purchases on this account.</p>}

      {ordered.map((purchase: Purchase) => (
        <div
          key={purchase.id}
          className="grid grid-cols-[8px_1fr_auto] items-center gap-2.5 border-b border-hairline py-2 last:border-b-0"
        >
          <span className={`h-2 w-2 rounded-full ${DOT[purchase.status]}`} />
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-muted">
              {purchase.id} · {purchase.type}
            </div>
            <div className="text-[11px] text-faint">{formatWhen(purchase.at)}</div>
          </div>
          <div className="text-right">
            <div className={`font-mono text-[13px] ${AMOUNT[purchase.status]}`}>
              ₹{purchase.amount_inr.toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-faint">{purchase.status}</div>
          </div>
        </div>
      ))}

      <div className="mt-3 flex justify-between border-t border-line pt-3 text-xs">
        <span className="text-muted">Actually captured</span>
        <strong className="font-mono text-money">₹{total.toLocaleString('en-IN')}</strong>
      </div>
      <div className="mt-1 flex justify-between text-xs">
        <span className="text-muted">App opens since charge</span>
        <strong className="font-mono">{ticket.app_opens_since_renewal}</strong>
      </div>
    </Card>
  );
}
