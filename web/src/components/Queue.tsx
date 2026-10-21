import type { Ticket, TriageResponse } from '../types';
import { Pill, SeverityTag } from './ui';

export function Queue({
  tickets,
  results,
  selectedId,
  onSelect,
}: {
  tickets: Ticket[];
  results: Record<string, TriageResponse>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="h-full overflow-y-auto border-r border-line bg-panel">
      <div className="sticky top-0 border-b border-hairline bg-panel px-4 pt-3 pb-2.5 text-[11px] tracking-[0.08em] text-faint uppercase">
        Inbox · {tickets.length}
      </div>

      {tickets.map((ticket) => {
        const result = results[ticket.id];
        const active = ticket.id === selectedId;

        return (
          <button
            key={ticket.id}
            onClick={() => onSelect(ticket.id)}
            className={`block w-full cursor-pointer border-b border-l-2 border-hairline px-4 py-2.5 text-left transition-colors ${
              active ? 'border-l-accent bg-raised' : 'border-l-transparent hover:bg-raised'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted">{ticket.id}</span>
              {result && <SeverityTag severity={result.severity} />}
            </div>

            <div className="mt-0.5 truncate text-[13px]">{ticket.subject}</div>

            {result && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {result.refund.decision === 'refund' && (
                  <Pill tone="money">₹{result.refund.amount_inr.toLocaleString('en-IN')}</Pill>
                )}
                {result.needs_human && <Pill tone="human">human</Pill>}
                {result.flags.prompt_injection_suspected && <Pill tone="inject">injection</Pill>}
                {result.meta.degraded !== 'none' && <Pill tone="danger">degraded</Pill>}
              </div>
            )}
          </button>
        );
      })}
    </nav>
  );
}
