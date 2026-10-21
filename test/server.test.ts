import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { ReplayProvider } from '../src/llm/replay.js';
import { createLogger } from '../src/log.js';
import { loadConfig } from '../src/config.js';
import { ticket } from './helpers.js';

const app = buildServer({
  config: { ...loadConfig(), mode: 'replay', apiKey: null, confidenceFloor: 0.6 },
  provider: new ReplayProvider(),
  logger: createLogger('error'), // keep test output readable
});

afterAll(async () => {
  await app.close();
});

describe('POST /triage', () => {
  it('accepts a ticket in the file\'s own shape, unmodified', async () => {
    const response = await app.inject({ method: 'POST', url: '/triage', payload: ticket('T-1001') });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ticket_id).toBe('T-1001');
    expect(body.refund.currency).toBe('INR');
  });

  it('rejects a malformed ticket with 400 and issue PATHS only', async () => {
    const broken = { ...ticket('T-1001'), purchases: [{ id: 'pay_X', type: 'trial', amount_inr: 1, status: 'TOTALLY_INVALID_STATUS', at: '2026-01-01T00:00:00+05:30' }] };
    const response = await app.inject({ method: 'POST', url: '/triage', payload: broken });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('invalid_ticket');
    expect(body.issues[0].path).toBe('purchases.0.status');
    // The rejected VALUE must not be echoed -- it may be user text.
    expect(JSON.stringify(body)).not.toContain('TOTALLY_INVALID_STATUS');
  });

  it('rejects a body that is not a ticket at all', async () => {
    const response = await app.inject({ method: 'POST', url: '/triage', payload: { hello: 'world' } });
    expect(response.statusCode).toBe(400);
  });

  it('is idempotent across HTTP requests', async () => {
    const first = await app.inject({ method: 'POST', url: '/triage', payload: ticket('T-1012') });
    const second = await app.inject({ method: 'POST', url: '/triage', payload: ticket('T-1012') });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().meta.idempotent_replay).toBe(true);
    expect(second.json().refund).toEqual(first.json().refund);
  });

  it('a ticket with no recorded response degrades rather than 500ing', async () => {
    const unknown = { ...ticket('T-1006'), id: 'T-UNRECORDED' };
    const response = await app.inject({ method: 'POST', url: '/triage', payload: unknown });

    expect(response.statusCode).toBe(200);
    expect(response.json().meta.degraded).toBe('model_unavailable');
    expect(response.json().refund.amount_inr).toBe(0);
  });
});

describe('health endpoints', () => {
  it('healthz has no dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('readyz reports the mode and does not leak the model name in replay', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.json().mode).toBe('replay');
    expect(response.json().model).toBeNull();
  });
});
