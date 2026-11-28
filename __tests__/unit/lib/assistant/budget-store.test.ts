import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { admitBudget } from '@/lib/assistant/budget-store';

// Exercise the ioredis reply boundary. The integration suite executes the scripts themselves.
const user = { userId: 'private-user-id', orgId: 'private-org-id' };
function transport() {
  const time = jest.fn().mockResolvedValue(['1796083199', '0']);
  const evaluate = jest.fn().mockResolvedValue(['ok']);
  const client = { time, eval: evaluate } as unknown as Redis;
  return { time, evaluate, admit: (id = randomUUID()) => admitBudget(client, user, id) };
}

it('rejects untrusted Redis times before a reservation can be written', async () => {
  const { time, evaluate, admit } = transport();
  time
    .mockResolvedValueOnce(['not a timestamp', '0'])
    .mockRejectedValueOnce(new Error('private Redis URI'));
  for (let i = 0; i < 2; i++)
    await expect(admit()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Assistant budget is unavailable',
    });
  expect(evaluate).not.toHaveBeenCalled();
});

it('derives the retry period from the new Redis time and keeps identities out of script arguments', async () => {
  const { time, evaluate, admit } = transport();
  const seconds = (date: string) => String(Date.parse(date) / 1000);
  time
    .mockResolvedValueOnce([seconds('2026-11-30T23:59:59Z'), '0'])
    .mockResolvedValueOnce([seconds('2026-12-01T00:00:00Z'), '0']);
  evaluate.mockResolvedValueOnce(['rollover']).mockResolvedValueOnce(['ok']);
  const id = randomUUID();
  await admit(id);
  expect(time).toHaveBeenCalledTimes(2);
  const [november, december] = evaluate.mock.calls;
  expect(november).toEqual(
    expect.arrayContaining([
      '{assistant-budget}:day:2026-11-30',
      '{assistant-budget}:month:2026-11',
    ])
  );
  expect(december).toEqual(
    expect.arrayContaining([
      '{assistant-budget}:day:2026-12-01',
      '{assistant-budget}:month:2026-12',
    ])
  );
  const argumentsSent = JSON.stringify(evaluate.mock.calls);
  for (const privateId of [id, user.userId, user.orgId])
    expect(argumentsSent).not.toContain(privateId);
});

it('stops after a second inconsistent period instead of repeatedly attempting admission', async () => {
  const { time, evaluate, admit } = transport();
  evaluate.mockResolvedValue(['rollover']);
  await expect(admit()).rejects.toMatchObject({ statusCode: 503 });
  expect(time).toHaveBeenCalledTimes(2);
  expect(evaluate).toHaveBeenCalledTimes(2);
});

it('distinguishes a quota or duplicate denial from a malformed admission reply', async () => {
  const { evaluate, admit } = transport();
  evaluate.mockResolvedValueOnce(['limit', 17]);
  await expect(admit()).rejects.toMatchObject({ statusCode: 429, metadata: { retryAfter: 17 } });
  evaluate.mockResolvedValueOnce(['duplicate']);
  await expect(admit()).rejects.toMatchObject({ statusCode: 409 });
  expect(evaluate).toHaveBeenCalledTimes(2);
  for (const reply of [null, ['limit', -1], ['limit', '17'], ['ok', 'extra']]) {
    evaluate.mockResolvedValueOnce(reply);
    await expect(admit()).rejects.toMatchObject({ statusCode: 503 });
    expect(evaluate.mock.lastCall?.at(-1)).toBe('cancel-unpublished');
  }
});

it('rejects invalid attempt numbers before sending a transition to Redis', async () => {
  const { evaluate, admit } = transport();
  const lease = await admit();
  evaluate.mockClear();
  await expect(lease.begin(5)).rejects.toMatchObject({ statusCode: 503 });
  await expect(lease.cancelUnsubmitted(0)).rejects.toMatchObject({ statusCode: 503 });
  await expect(lease.record(1.5, 10)).rejects.toMatchObject({ statusCode: 503 });
  expect(evaluate).not.toHaveBeenCalled();
});

it('rejects malformed settlements and accepts only a complete retained reservation', async () => {
  const { evaluate, admit } = transport();
  const lease = await admit();
  for (const reply of [
    ['retained', 15],
    ['settled', -1],
    ['settled', 20_001],
    ['settled', '15'],
    ['settled', 15, 'extra'],
    ['unknown', 15],
  ]) {
    evaluate.mockResolvedValueOnce(reply);
    await expect(lease.settle()).rejects.toMatchObject({ statusCode: 503 });
  }
  evaluate.mockResolvedValueOnce(['retained', 20_000]);
  await expect(lease.settle()).resolves.toEqual({
    status: 'retained',
    chargedMicrodollars: 20_000,
  });
});
