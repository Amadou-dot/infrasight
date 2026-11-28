import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { ApiError } from '@/lib/errors';
import { getRedisClient } from '@/lib/redis/client';
import { reauthorizeAssistant, type DatasetScope } from '@/lib/assistant/access';
import { reserve } from '@/lib/assistant/budget';
import { admitBudget, type StoredBudget } from '@/lib/assistant/budget-store';

jest.mock('@/lib/redis/client', () => ({ getRedisClient: jest.fn() }));
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }));
jest.mock('@/lib/assistant/access', () => ({ reauthorizeAssistant: jest.fn() }));
jest.mock('@/lib/assistant/budget-store', () => ({ admitBudget: jest.fn() }));

const controller = () => new AbortController();
const scope = (): DatasetScope => ({
  userId: 'pilot',
  orgId: 'owner',
  sessionId: 'session',
  datasetId: 'building',
  policyVersion: 'pilot',
  asOf: new Date().toISOString(),
});
const receipt = {
  model: 'gpt-6-luna',
  service_tier: 'default',
  output_text: 'example',
  usage: {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 10,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 110,
  },
};
let store: jest.Mocked<StoredBudget>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.replaceProperty(process, 'env', { ...process.env });
  delete process.env.ASSISTANT_MODEL;
  delete process.env.ASSISTANT_RATE_CARD;
  jest.mocked(getRedisClient).mockReturnValue({} as NonNullable<ReturnType<typeof getRedisClient>>);
  jest.mocked(reauthorizeAssistant).mockResolvedValue(undefined);
  store = {
    begin: jest.fn().mockResolvedValue(undefined),
    cancelUnsubmitted: jest.fn().mockResolvedValue(undefined),
    record: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue({ status: 'settled', chargedMicrodollars: 15 }),
  };
  jest.mocked(admitBudget).mockResolvedValue(store);
});
afterEach(() => jest.restoreAllMocks());

function registeredCleanup() {
  expect(after).toHaveBeenCalledTimes(1);
  const [task] = jest.mocked(after).mock.calls[0];
  if (typeof task !== 'function') throw new Error('Expected request-lifetime cleanup');
  return task();
}

it('authorizes and reserves before generation, passes the fixed SDK policy and settles known usage', async () => {
  const ctx = scope(),
    id = randomUUID();
  const lease = await reserve(ctx, id);
  const generate = jest.fn().mockResolvedValue(receipt);
  await expect(lease.runAttempt(100, controller().signal, generate)).resolves.toBe(receipt);
  expect(reauthorizeAssistant).toHaveBeenCalledTimes(2);
  expect(admitBudget).toHaveBeenCalledWith(expect.any(Object), ctx, id);
  expect(store.begin.mock.invocationCallOrder[0]).toBeLessThan(
    generate.mock.invocationCallOrder[0]
  );
  expect(generate).toHaveBeenCalledWith(
    {
      model: 'gpt-6-luna',
      service_tier: 'default',
      reasoning: { effort: 'none' },
      max_output_tokens: 1200,
      store: false,
    },
    { signal: expect.any(AbortSignal), maxRetries: 0 }
  );
  expect(store.record).toHaveBeenCalledWith(1, 15);
  await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 15 });
});

it('does not reserve for a revoked pilot or an unknown rate card', async () => {
  jest.mocked(reauthorizeAssistant).mockRejectedValueOnce(ApiError.forbidden());
  await expect(reserve(scope(), randomUUID())).rejects.toMatchObject({ statusCode: 403 });
  process.env.ASSISTANT_RATE_CARD = 'unreviewed';
  await expect(reserve(scope(), randomUUID())).rejects.toMatchObject({ statusCode: 503 });
  expect(admitBudget).not.toHaveBeenCalled();
});

it('fails closed and sanitizes unavailable Redis', async () => {
  jest.mocked(getRedisClient).mockReturnValueOnce(null);
  await expect(reserve(scope())).rejects.toMatchObject({ statusCode: 503 });
  jest.mocked(admitBudget).mockRejectedValueOnce(new Error('private Redis address'));
  await expect(reserve(scope())).rejects.toMatchObject({
    statusCode: 503,
    message: expect.not.stringContaining('private'),
  });
});

it('exposes a quota denial with a usable HTTP Retry-After', async () => {
  jest.mocked(admitBudget).mockRejectedValueOnce(ApiError.rateLimitExceeded(12));
  const response = await reserve(scope()).catch((denial: ApiError) => denial.toResponse());
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(429);
  expect((response as Response).headers.get('Retry-After')).toBe('12');
});

it('permits no submission when the input, authorization, or price policy no longer passes', async () => {
  const generate = jest.fn();
  const lease = await reserve(scope());
  await expect(lease.runAttempt(12_001, controller().signal, generate)).rejects.toThrow();
  const revoked = await reserve(scope());
  jest.mocked(reauthorizeAssistant).mockRejectedValueOnce(ApiError.forbidden());
  await expect(revoked.runAttempt(1, controller().signal, generate)).rejects.toMatchObject({
    statusCode: 403,
  });
  const changed = await reserve(scope());
  process.env.ASSISTANT_MODEL = 'different';
  await expect(changed.runAttempt(1, controller().signal, generate)).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(store.begin).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it('records an interrupted submission as uncertain and prevents a second generation', async () => {
  const lease = await reserve(scope());
  const submitted = Promise.withResolvers<void>();
  const late = Promise.withResolvers<typeof receipt>();
  const generate = jest.fn(() => {
    submitted.resolve();
    return late.promise;
  });
  const caller = controller();
  const attempt = lease.runAttempt(100, caller.signal, generate);
  await submitted.promise;
  caller.abort(new Error('private caller reason'));
  await expect(attempt).rejects.toMatchObject({
    name: 'AbortError',
    message: expect.not.stringContaining('private'),
  });
  expect(store.record).toHaveBeenCalledWith(1, null);
  late.resolve(receipt);
  await expect(lease.runAttempt(100, controller().signal, generate)).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(store.record).toHaveBeenCalledTimes(1);
  await lease.settle();
});

it.each([
  { ...receipt, usage: undefined },
  { ...receipt, model: 'another-model' },
])('retains the reservation for an unpriceable receipt', async response => {
  const lease = await reserve(scope());
  await expect(
    lease.runAttempt(100, controller().signal, async () => response)
  ).rejects.toMatchObject({ statusCode: 503 });
  expect(store.record).toHaveBeenCalledWith(1, null);
});

it('keeps the hold on a provider error or an unavailable accounting write', async () => {
  const failed = await reserve(scope());
  await expect(
    failed.runAttempt(100, controller().signal, async () => {
      throw new Error('private provider body');
    })
  ).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') });
  expect(store.record).toHaveBeenCalledWith(1, null);
  const lease = await reserve(scope());
  store.record.mockRejectedValueOnce(new Error('private database text'));
  await expect(
    lease.runAttempt(100, controller().signal, async () => receipt)
  ).rejects.toMatchObject({ statusCode: 503, message: expect.not.stringContaining('private') });
  const generate = jest.fn();
  await expect(lease.runAttempt(100, controller().signal, generate)).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
  await lease.settle();
  expect(
    store.record.mock.calls.filter(([attempt, charge]) => attempt === 1 && charge === 15)
  ).toHaveLength(2);
});

it('refunds a request cancelled after claiming an attempt but before submission', async () => {
  const lease = await reserve(scope());
  const caller = controller();
  store.begin.mockImplementationOnce(async () => caller.abort());
  const generate = jest.fn();
  await expect(lease.runAttempt(1, caller.signal, generate)).rejects.toMatchObject({
    name: 'AbortError',
  });
  await lease.settle();
  expect(store.cancelUnsubmitted).toHaveBeenCalledWith(1);
  expect(generate).not.toHaveBeenCalled();
});

it('waits for an in-flight receipt before releasing a concurrent settlement', async () => {
  const lease = await reserve(scope());
  const started = Promise.withResolvers<void>(),
    receiptPending = Promise.withResolvers<typeof receipt>();
  const attempt = lease.runAttempt(100, controller().signal, () => {
    started.resolve();
    return receiptPending.promise;
  });
  await started.promise;
  const settling = lease.settle();
  const generate = jest.fn();
  await expect(lease.runAttempt(100, controller().signal, generate)).rejects.toThrow();
  expect(store.settle).not.toHaveBeenCalled();
  receiptPending.resolve(receipt);
  await Promise.all([attempt, settling]);
  expect(store.record.mock.invocationCallOrder[0]).toBeLessThan(
    store.settle.mock.invocationCallOrder[0]
  );
  expect(generate).not.toHaveBeenCalled();
});

it('submits four generations and rejects a fifth without changing the known charge', async () => {
  const lease = await reserve(scope());
  const generate = jest.fn().mockResolvedValue(receipt);
  for (let i = 0; i < 4; i++) await lease.runAttempt(100, controller().signal, generate);
  await expect(lease.runAttempt(100, controller().signal, generate)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(generate).toHaveBeenCalledTimes(4);
  expect(store.record.mock.calls).toEqual([
    [1, 15],
    [2, 15],
    [3, 15],
    [4, 15],
  ]);
  store.settle.mockResolvedValueOnce({ status: 'settled', chargedMicrodollars: 60 });
  await expect(lease.settle()).resolves.toEqual({ status: 'settled', chargedMicrodollars: 60 });
});

it('times out admission immediately and releases a late unpublished lease', async () => {
  const started = Promise.withResolvers<void>(),
    admission = Promise.withResolvers<StoredBudget>();
  jest.mocked(admitBudget).mockImplementationOnce(() => {
    started.resolve();
    return admission.promise;
  });
  const deadline = controller();
  const clock = jest.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
  const result = reserve(scope()).catch((error: unknown) => error);
  await started.promise;
  deadline.abort(new DOMException('expired', 'TimeoutError'));
  const timedOut = await Promise.race([
    result,
    new Promise(resolve => setImmediate(() => resolve('still waiting'))),
  ]);
  const draining = registeredCleanup();
  expect(store.settle).not.toHaveBeenCalled();
  admission.resolve(store);
  await draining;
  expect(timedOut).toMatchObject({ statusCode: 503, message: 'Assistant request timed out' });
  expect(store.settle).toHaveBeenCalledTimes(1);
  expect(clock).toHaveBeenCalled();
});

it.each(['begin', 'record'] as const)(
  'returns at the deadline while a Redis %s acknowledgement is delayed',
  async stage => {
    const started = Promise.withResolvers<void>(),
      ack = Promise.withResolvers<void>();
    store[stage].mockImplementationOnce(() => {
      started.resolve();
      return ack.promise;
    });
    const deadline = controller();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const lease = await reserve(scope());
    const generate = jest.fn().mockResolvedValue(receipt);
    const result = lease
      .runAttempt(100, controller().signal, generate)
      .catch((error: unknown) => error);
    await started.promise;
    deadline.abort(new DOMException('expired', 'TimeoutError'));
    const timedOut = await Promise.race([
      result,
      new Promise(resolve => setImmediate(() => resolve('still waiting'))),
    ]);
    const finalizing = lease.settle().catch((error: unknown) => error);
    const finalStatus = await Promise.race([
      finalizing,
      new Promise(resolve => setImmediate(() => resolve('still waiting'))),
    ]);
    const draining = registeredCleanup();
    expect(store.settle).not.toHaveBeenCalled();
    ack.resolve();
    await draining;
    expect(timedOut).toMatchObject({ statusCode: 503 });
    expect(finalStatus).toMatchObject({ statusCode: 503 });
    expect(store.settle).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(stage === 'begin' ? 0 : 1);
    if (stage === 'begin') expect(store.cancelUnsubmitted).toHaveBeenCalledWith(1);
    else expect(store.record).toHaveBeenCalledWith(1, 15);
  }
);
