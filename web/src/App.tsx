import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, fetchTickets, triage, type Health } from './api';
import type { Ticket, TriageResponse } from './types';
import { Detail } from './components/Detail';
import { Queue } from './components/Queue';
import { Sandbox } from './components/Sandbox';

type Tab = 'inbox' | 'sandbox';

export default function App() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [results, setResults] = useState<Record<string, TriageResponse>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<Tab>('inbox');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchTickets(), fetchHealth()])
      .then(([loaded, status]) => {
        setTickets(loaded);
        setHealth(status);
        if (loaded[0]) setSelectedId(loaded[0].id);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const run = useCallback(
    async (ticket: Ticket) => {
      setPendingId(ticket.id);
      const response = await triage(ticket);
      if (response.ok) {
        setResults((previous) => ({ ...previous, [ticket.id]: response.data }));
      }
      setPendingId(null);
    },
    [],
  );

  // Triage every ticket once on load so the queue shows real badges rather
  // than filling in as you click.
  useEffect(() => {
    tickets.forEach((ticket) => {
      if (!results[ticket.id]) void run(ticket);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-panel px-5">
        <h1 className="text-sm font-semibold tracking-tight">Dhaba support triage</h1>
        <span className="text-xs text-faint">agent console</span>

        <nav className="ml-4 flex gap-0.5">
          {(['inbox', 'sandbox'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-[13px] capitalize ${
                tab === value
                  ? 'border-accent text-body'
                  : 'border-transparent text-muted hover:text-body'
              }`}
            >
              {value}
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {health && (
          <span
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
              health.mode === 'live' ? 'border-money/40 text-money' : 'border-line text-muted'
            }`}
          >
            {health.mode}
            {health.model ? ` · ${health.model}` : ''}
          </span>
        )}
      </header>

      {loadError && (
        <div className="m-5 rounded-lg border border-danger/35 bg-danger/10 p-3 text-[13px] text-danger">
          {loadError} — is the API running on port 3000?
        </div>
      )}

      {tab === 'sandbox' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Sandbox />
        </main>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[290px_1fr]">
          <Queue
            tickets={tickets}
            results={results}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <main className="min-h-0 overflow-y-auto">
            {selected ? (
              <Detail
                ticket={selected}
                result={results[selected.id]}
                pending={pendingId === selected.id}
                onRerun={() => void run(selected)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-faint">
                {loadError ? 'Could not load the inbox.' : 'Loading…'}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
