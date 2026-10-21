import type { Ticket, TriageResponse } from '../types';
import { DecisionCard } from './DecisionCard';
import { Ledger } from './Ledger';
import { Banner, Card, Pill, Row, SeverityTag } from './ui';

const CONFIDENCE_FLOOR = 0.55;

export function Detail({
  ticket,
  result,
  pending,
  onRerun,
}: {
  ticket: Ticket;
  result: TriageResponse | undefined;
  pending: boolean;
  onRerun: () => void;
}) {
  const injected = result?.flags.prompt_injection_suspected ?? false;
  const lowConfidence = result ? result.confidence < CONFIDENCE_FLOOR : false;

  return (
    <div className="mx-auto max-w-[940px] px-6 pt-5 pb-16">
      <header className="mb-4">
        <div className="mb-1 flex items-center gap-2.5">
          <h2 className="text-[19px] font-semibold tracking-tight">{ticket.subject}</h2>
          {result && <SeverityTag severity={result.severity} />}
        </div>
        <div className="font-mono text-xs text-faint">
          {ticket.id} · received {new Date(ticket.received_at).toLocaleString('en-IN')}
        </div>
      </header>

      <blockquote
        className={`mb-5 rounded-[10px] border border-l-2 border-line bg-panel p-3.5 text-[13px] whitespace-pre-wrap text-muted ${
          injected ? 'border-l-inject' : 'border-l-line'
        }`}
      >
        {ticket.body}
      </blockquote>

      {pending && <p className="text-[13px] text-faint">Triaging…</p>}

      {result && (
        <>
          {injected && (
            <Banner tone="inject" icon="⚠" title="This ticket contains text aimed at the assistant">
              It was classified on its genuine request and flagged. No instruction inside it
              could reach a refund, because the gate reads the ledger rather than the body.
            </Banner>
          )}

          {result.meta.degraded !== 'none' && (
            <Banner tone="degraded" icon="◆" title={`Degraded: ${result.meta.degraded}`}>
              The rules still decided the money. The classification did not come from a model.
            </Banner>
          )}

          {result.needs_human && !injected && (
            <Banner tone="human" icon="●" title="Needs a human before this sends" />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <DecisionCard result={result} />
              <Ledger ticket={ticket} />
            </div>

            <div className="flex flex-col gap-4">
              <Card title="Classification">
                <Row label="category">{result.category}</Row>
                <Row label="severity">{result.severity}</Row>
                <Row label="language">{result.language}</Row>
                <Row label="needs human">{result.needs_human ? 'yes' : 'no'}</Row>

                <div className="mt-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">confidence</span>
                    <span className="font-mono">{result.confidence.toFixed(2)}</span>
                  </div>
                  <div className="my-1.5 h-1 overflow-hidden rounded-sm bg-line">
                    <div
                      className={`h-full ${lowConfidence ? 'bg-hold' : 'bg-accent'}`}
                      style={{ width: `${Math.round(result.confidence * 100)}%` }}
                    />
                  </div>
                  <p className={`text-xs ${lowConfidence ? 'text-hold' : 'text-muted'}`}>
                    {lowConfidence
                      ? `Below the ${CONFIDENCE_FLOOR} floor, so it routes to a person rather than being acted on.`
                      : 'Above the routing floor.'}
                  </p>
                </div>

                <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted">
                  {result.summary}
                </p>
              </Card>

              {result.escalations.length > 0 && (
                <Card title="Ledger escalations">
                  <p className="mb-2 text-xs text-muted">
                    Raised by the billing record, not by anything in the text.
                  </p>
                  {result.escalations.map((escalation) => (
                    <div
                      key={escalation.code}
                      className="flex items-center gap-2 border-t border-hairline py-1.5 text-xs first:border-t-0"
                    >
                      <span className="font-mono text-[11px] text-hold">{escalation.code}</span>
                      <Pill>min {escalation.severity_floor}</Pill>
                      {escalation.requires_human && <Pill tone="human">human</Pill>}
                    </div>
                  ))}
                </Card>
              )}

              <Card title="Service">
                <Row label="mode">{result.meta.mode}</Row>
                <Row label="model attempts">{result.meta.model_attempts}</Row>
                <Row label="idempotent replay">
                  {result.meta.idempotent_replay ? 'yes — stored decision' : 'no — decided now'}
                </Row>
                <div className="mt-3 flex items-center gap-2.5">
                  <button
                    onClick={onRerun}
                    className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] text-muted hover:border-muted hover:text-body"
                  >
                    Send again
                  </button>
                  <span className="text-xs text-faint">
                    Same ticket id. Watch the replay flag, not the money.
                  </span>
                </div>
              </Card>
            </div>
          </div>

          <Card className="mt-4" title={`Drafted reply`}>
            <div className="mb-2 flex items-center">
              <span className="text-xs text-muted">Written in the user's language</span>
              <span className="ml-2 rounded border border-line px-1.5 py-px font-mono text-[10px] text-faint">
                {result.language}
              </span>
            </div>
            <p className="rounded-lg border border-line bg-raised p-3.5 text-[13px] leading-relaxed whitespace-pre-wrap">
              {result.reply_draft}
            </p>
            <p className="mt-2 text-xs text-faint">
              The model wrote the explanation. The sentence about the payment was generated from
              the rule that fired.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
