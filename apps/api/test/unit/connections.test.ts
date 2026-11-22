import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { isConnectionLost, withReadRetry } from '../../src/infra/connections.js';

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

function fakePool(failures: number) {
  const calls: unknown[] = [];
  const pool = {
    query: async (q: unknown) => {
      calls.push(q);
      if (calls.length <= failures) throw reset();
      return { rows: [{ ok: true }] };
    },
  };
  return { pool: withReadRetry(pool as unknown as pg.Pool), calls };
}

describe('withReadRetry', () => {
  it('retries a SELECT once after a lost connection', async () => {
    const { pool, calls } = fakePool(1);
    await expect(pool.query({ text: 'select 1', values: [] })).resolves.toEqual({
      rows: [{ ok: true }],
    });
    expect(calls).toHaveLength(2);
  });

  it('gives up after one retry', async () => {
    const { pool, calls } = fakePool(2);
    await expect(pool.query('SELECT 1')).rejects.toThrow('ECONNRESET');
    expect(calls).toHaveLength(2);
  });

  it('never retries writes', async () => {
    for (const text of [
      'insert into t values (1)',
      'update t set a = 1',
      'with x as (delete from t returning *) select * from x',
    ]) {
      const { pool, calls } = fakePool(1);
      await expect(pool.query({ text })).rejects.toThrow('ECONNRESET');
      expect(calls).toHaveLength(1);
    }
  });

  it('does not retry ordinary query errors', async () => {
    const calls: unknown[] = [];
    const pool = withReadRetry({
      query: async (q: unknown) => {
        calls.push(q);
        throw Object.assign(new Error('syntax error'), { code: '42601' });
      },
    } as unknown as pg.Pool);
    await expect(pool.query('select oops')).rejects.toThrow('syntax error');
    expect(calls).toHaveLength(1);
  });

  it('recognises lost-connection errors, including wrapped ones', () => {
    expect(isConnectionLost(reset())).toBe(true);
    expect(isConnectionLost({ cause: { code: 'EPIPE' } })).toBe(true);
    expect(isConnectionLost(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isConnectionLost(new Error('duplicate key'))).toBe(false);
    expect(isConnectionLost(null)).toBe(false);
  });
});
