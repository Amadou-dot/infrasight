import {
  assertBudgetConfiguration,
  BUDGET_LIMITS,
  GENERATION_POLICY,
  priceResponse,
  RATE_CARD_ID,
} from '@/lib/assistant/pricing';
import { ApiError } from '@/lib/errors';

it('publishes the fixed provider settings as immutable request parameters', () => {
  expect(GENERATION_POLICY).toEqual({
    model: 'gpt-6-luna',
    service_tier: 'default',
    reasoning: { effort: 'none' },
    max_output_tokens: 1_200,
    store: false,
  });
  expect(Object.isFrozen(GENERATION_POLICY)).toBe(true);
  expect(Object.isFrozen(GENERATION_POLICY.reasoning)).toBe(true);
  expect(Object.isFrozen(BUDGET_LIMITS)).toBe(true);
});

const ordinaryUsage = {
  input_tokens: 110,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens: 26,
  output_tokens_details: { reasoning_tokens: 10 },
  total_tokens: 136,
};

const zeroHostedToolUsage = {
  image_gen: {
    input_tokens: 0,
    input_tokens_details: { text_tokens: 0, image_tokens: 0 },
    output_tokens: 0,
    total_tokens: 0,
  },
  web_search: { num_requests: 0 },
};

function response(usage: unknown = ordinaryUsage) {
  return { model: 'gpt-6-luna', service_tier: 'default', usage };
}

function inputDetails(cached: number, written: number, ttl30m: number, ttl12h: number) {
  return {
    cached_tokens: cached,
    cache_write_tokens: written,
    cache_write_tokens_details: { ttl_30m_tokens: ttl30m, ttl_12h_tokens: ttl12h },
  };
}

describe('priceResponse', () => {
  it.each([
    { kind: 'null', envelope: null },
    { kind: 'undefined', envelope: undefined },
    { kind: 'a primitive', envelope: 'unavailable' },
    { kind: 'an array', envelope: [response()] },
  ])('flags $kind as unknown usage when it replaces the response envelope', ({ envelope }) => {
    expect(priceResponse(envelope)).toEqual({ status: 'usage_unknown' });
  });

  it('accepts ordinary metadata outside the usage envelope', () => {
    const providerResponse = { ...response(), id: 'resp_example', status: 'completed', output: [] };
    expect(priceResponse(providerResponse)).toEqual({ status: 'known', microdollars: 24 });
  });

  it.each([
    zeroHostedToolUsage,
    {
      ...zeroHostedToolUsage,
      image_gen: {
        ...zeroHostedToolUsage.image_gen,
        output_tokens_details: { text_tokens: 0, image_tokens: 0 },
        cached_tokens: 0,
        cached_tokens_details: { cached_text_tokens: 0, cached_image_tokens: 0 },
      },
    },
  ])('accepts documented zero hosted tool usage', tool_usage => {
    expect(priceResponse({ ...response(), tool_usage })).toEqual({
      status: 'known',
      microdollars: 24,
    });
  });

  it.each([
    {
      kind: 'billable web search',
      tool_usage: { ...zeroHostedToolUsage, web_search: { num_requests: 1 } },
    },
    {
      kind: 'billable image generation',
      tool_usage: {
        ...zeroHostedToolUsage,
        image_gen: { ...zeroHostedToolUsage.image_gen, total_tokens: 1 },
      },
    },
    {
      kind: 'nonzero optional detail',
      tool_usage: {
        ...zeroHostedToolUsage,
        image_gen: { ...zeroHostedToolUsage.image_gen, cached_tokens: 1 },
      },
    },
    {
      kind: 'unknown tool family',
      tool_usage: { ...zeroHostedToolUsage, file_search: { num_requests: 0 } },
    },
    {
      kind: 'incomplete tool usage',
      tool_usage: { web_search: { num_requests: 0 } },
    },
    { kind: 'malformed tool usage', tool_usage: null },
  ])('flags $kind as unknown pricing', ({ tool_usage }) => {
    expect(priceResponse({ ...response(), tool_usage })).toEqual({ status: 'pricing_unknown' });
  });

  it('prices ordinary input and counts reasoning only within output tokens', () => {
    expect(priceResponse(response())).toEqual({ status: 'known', microdollars: 24 });
  });

  it('prices explicitly reported zero usage at zero', () => {
    expect(
      priceResponse(
        response({
          input_tokens: 0,
          input_tokens_details: inputDetails(0, 0, 0, 0),
          output_tokens: 0,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 0,
        })
      )
    ).toEqual({ status: 'known', microdollars: 0 });
  });

  it.each([
    { kind: 'cached reads', details: inputDetails(110, 0, 0, 0), microdollars: 15 },
    { kind: '30-minute writes', details: inputDetails(0, 110, 110, 0), microdollars: 27 },
    { kind: '12-hour writes', details: inputDetails(0, 110, 0, 110), microdollars: 41 },
  ])('prices $kind at their reviewed rate', ({ details, microdollars }) => {
    expect(priceResponse(response({ ...ordinaryUsage, input_tokens_details: details }))).toEqual({
      status: 'known',
      microdollars,
    });
  });

  it('prices ordinary input, cache reads, both write lifetimes, and output as disjoint categories', () => {
    expect(
      priceResponse(
        response({
          ...ordinaryUsage,
          input_tokens: 12_000,
          input_tokens_details: inputDetails(4_000, 7_000, 3_000, 4_000),
          total_tokens: 12_026,
        })
      )
    ).toEqual({ status: 'known', microdollars: 1528 });
  });

  it('rounds the fractional price up once per attempt', () => {
    expect(
      priceResponse(
        response({
          input_tokens: 4,
          input_tokens_details: inputDetails(1, 2, 1, 1),
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 5,
        })
      )
    ).toEqual({ status: 'known', microdollars: 1 });
  });

  it.each([
    { defect: 'no usage', usage: null },
    { defect: 'non-object usage', usage: [] },
    { defect: 'missing input details', usage: { ...ordinaryUsage, input_tokens_details: null } },
    { defect: 'missing output details', usage: { ...ordinaryUsage, output_tokens_details: null } },
    { defect: 'missing token total', usage: { ...ordinaryUsage, total_tokens: undefined } },
    {
      defect: 'missing cached reads',
      usage: { ...ordinaryUsage, input_tokens_details: { cache_write_tokens: 0 } },
    },
    {
      defect: 'missing cache writes',
      usage: { ...ordinaryUsage, input_tokens_details: { cached_tokens: 0 } },
    },
    {
      defect: 'missing reasoning count',
      usage: { ...ordinaryUsage, output_tokens_details: {} },
    },
    {
      defect: 'missing lifetime breakdown for positive writes',
      usage: {
        ...ordinaryUsage,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 },
      },
    },
    {
      defect: 'missing lifetime count inside a breakdown',
      usage: {
        ...ordinaryUsage,
        input_tokens_details: {
          cached_tokens: 0,
          cache_write_tokens: 0,
          cache_write_tokens_details: { ttl_30m_tokens: 0 },
        },
      },
    },
    {
      defect: 'null lifetime breakdown',
      usage: {
        ...ordinaryUsage,
        input_tokens_details: {
          ...ordinaryUsage.input_tokens_details,
          cache_write_tokens_details: null,
        },
      },
    },
    { defect: 'fractional count', usage: { ...ordinaryUsage, input_tokens: 0.5 } },
    { defect: 'negative count', usage: { ...ordinaryUsage, output_tokens: -1 } },
    { defect: 'string count', usage: { ...ordinaryUsage, output_tokens: '26' } },
    { defect: 'infinite count', usage: { ...ordinaryUsage, input_tokens: Infinity } },
    { defect: 'NaN count', usage: { ...ordinaryUsage, total_tokens: NaN } },
    {
      defect: 'unsafe integer count',
      usage: { ...ordinaryUsage, input_tokens_details: inputDetails(2 ** 53, 0, 0, 0) },
    },
    {
      defect: 'input total above cap',
      usage: { ...ordinaryUsage, input_tokens: 12_001, total_tokens: 12_027 },
    },
    {
      defect: 'output total above cap',
      usage: { ...ordinaryUsage, output_tokens: 1_201, total_tokens: 1_311 },
    },
    { defect: 'inconsistent token total', usage: { ...ordinaryUsage, total_tokens: 137 } },
    {
      defect: 'cached reads plus writes exceeding input',
      usage: { ...ordinaryUsage, input_tokens_details: inputDetails(100, 11, 1, 10) },
    },
    {
      defect: 'inconsistent lifetime counts',
      usage: { ...ordinaryUsage, input_tokens_details: inputDetails(0, 10, 10, 1) },
    },
    {
      defect: 'reasoning count exceeding output',
      usage: { ...ordinaryUsage, output_tokens_details: { reasoning_tokens: 27 } },
    },
  ])('flags $defect as unknown usage', ({ usage }) => {
    expect(priceResponse(response(usage))).toEqual({ status: 'usage_unknown' });
  });

  it('flags absent usage when the reviewed model and tier are reported', () => {
    const { model, service_tier } = response();
    expect(priceResponse({ model, service_tier })).toEqual({ status: 'usage_unknown' });
  });

  it.each([
    { level: 'usage', usage: { ...ordinaryUsage, extra_tokens: 0 } },
    {
      level: 'input details',
      usage: {
        ...ordinaryUsage,
        input_tokens_details: { ...inputDetails(0, 0, 0, 0), image_tokens: 0 },
      },
    },
    {
      level: 'output details',
      usage: { ...ordinaryUsage, output_tokens_details: { reasoning_tokens: 0, extra_tokens: 0 } },
    },
    {
      level: 'cache write details',
      usage: {
        ...ordinaryUsage,
        input_tokens_details: {
          ...inputDetails(0, 0, 0, 0),
          cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0, ttl_24h_tokens: 0 },
        },
      },
    },
  ])('flags an unreviewed billing category in $level as unknown pricing', ({ usage }) => {
    expect(priceResponse(response(usage))).toEqual({ status: 'pricing_unknown' });
  });

  it.each([
    { field: 'model', value: 'gpt-6-sol' },
    { field: 'model', value: 'gpt-6-luna-unreviewed' },
    { field: 'model', value: undefined },
    { field: 'service_tier', value: 'auto' },
    { field: 'service_tier', value: 'flex' },
    { field: 'service_tier', value: 'priority' },
    { field: 'service_tier', value: undefined },
  ])('flags an unreviewed $field of $value as unknown pricing', ({ field, value }) => {
    expect(priceResponse({ ...response(), [field]: value })).toEqual({ status: 'pricing_unknown' });
  });

  it('prices the highest allowed token usage within the four-attempt reservation', () => {
    const actual = priceResponse({
      ...GENERATION_POLICY,
      usage: {
        input_tokens: BUDGET_LIMITS.maxInputTokens,
        input_tokens_details: inputDetails(0, 12_000, 0, 12_000),
        output_tokens: GENERATION_POLICY.max_output_tokens,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 13_200,
      },
    });

    expect(actual).toEqual({ status: 'known', microdollars: 3_600 });
    if (actual.status === 'known') {
      expect(actual.microdollars * BUDGET_LIMITS.maxAttempts).toBe(14_400);
      expect(actual.microdollars * BUDGET_LIMITS.maxAttempts).toBeLessThan(
        BUDGET_LIMITS.reservationMicrodollars
      );
    }
  });
});

describe('assertBudgetConfiguration', () => {
  beforeEach(() => {
    const env = { ...process.env };
    delete env.ASSISTANT_MODEL;
    delete env.ASSISTANT_RATE_CARD;
    jest.replaceProperty(process, 'env', env);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts the reviewed policy with either absent or matching configuration', () => {
    expect(() => assertBudgetConfiguration()).not.toThrow();
    process.env.ASSISTANT_MODEL = 'gpt-6-luna';
    process.env.ASSISTANT_RATE_CARD = RATE_CARD_ID;
    expect(() => assertBudgetConfiguration()).not.toThrow();
  });

  it.each([
    { variable: 'ASSISTANT_MODEL', secret: 'gpt-6-sol-example-secret' },
    { variable: 'ASSISTANT_RATE_CARD', secret: 'unreviewed-rate-example-secret' },
    { variable: 'ASSISTANT_MODEL', secret: '' },
    { variable: 'ASSISTANT_RATE_CARD', secret: '' },
  ])('rejects an explicit unsupported $variable with a sanitized 503', ({ variable, secret }) => {
    process.env[variable] = secret;

    expect.assertions(2);
    try {
      assertBudgetConfiguration();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).toJSON().error).toEqual({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Assistant budget is unavailable',
      });
    }
  });
});
