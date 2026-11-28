import { z } from 'zod';
import { ApiError } from '@/lib/errors';

export const BUDGET_LIMITS = Object.freeze({
  maxAttempts: 4,
  maxInputTokens: 12_000,
  maxOutputTokens: 1_200,
  requestMs: 45_000,
  reservationMicrodollars: 20_000,
  dailyMicrodollars: 2_000_000,
  monthlyMicrodollars: 20_000_000,
  requestsPerMinute: 5,
  requestsPerDay: 50,
  concurrentPerUser: 1,
  concurrentPerOrg: 3,
} as const);

export const RATE_CARD_ID = 'openai-gpt-6-luna-standard-v1';

// GPT-6 Luna, Standard processing, short context. Rates are thousandths of a
// microdollar per token, so the attempt is calculated in integers until rounding.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/guides/prompt-caching
const RATE_CARD = Object.freeze({
  model: 'gpt-6-luna',
  serviceTier: 'default',
  input: 100,
  cachedInput: 10,
  cacheWrite30m: 125,
  cacheWrite12h: 250,
  output: 500,
} as const);

export const GENERATION_POLICY = Object.freeze({
  model: RATE_CARD.model,
  service_tier: RATE_CARD.serviceTier,
  reasoning: Object.freeze({ effort: 'none' } as const),
  max_output_tokens: BUDGET_LIMITS.maxOutputTokens,
  store: false,
} as const);

const THOUSANDTHS_PER_MICRODOLLAR = 1_000;

export function assertBudgetConfiguration(): void {
  const { ASSISTANT_MODEL: model, ASSISTANT_RATE_CARD: rateCard } = process.env;
  const highestInputRate = Math.max(
    RATE_CARD.input,
    RATE_CARD.cachedInput,
    RATE_CARD.cacheWrite30m,
    RATE_CARD.cacheWrite12h
  );
  const maxAttemptMicrodollars = Math.ceil(
    (BUDGET_LIMITS.maxInputTokens * highestInputRate +
      GENERATION_POLICY.max_output_tokens * RATE_CARD.output) /
      THOUSANDTHS_PER_MICRODOLLAR
  );
  const maxRequestMicrodollars = BUDGET_LIMITS.maxAttempts * maxAttemptMicrodollars;
  if (
    (model !== undefined && model !== GENERATION_POLICY.model) ||
    (rateCard !== undefined && rateCard !== RATE_CARD_ID) ||
    !Number.isSafeInteger(maxRequestMicrodollars) ||
    maxRequestMicrodollars >= BUDGET_LIMITS.reservationMicrodollars
  )
    throw ApiError.serviceUnavailable('Assistant budget is unavailable');
}

const inputCount = z.number().int().min(0).max(BUDGET_LIMITS.maxInputTokens);
const outputCount = z.number().int().min(0).max(GENERATION_POLICY.max_output_tokens);

const responseSchema = z.object({
  model: z.unknown().optional(),
  service_tier: z.unknown().optional(),
  tool_usage: z.unknown().optional(),
  usage: z.unknown().optional(),
});

// Hosted tools are priced separately from model usage. Accept the documented
// empty accounting or no tool_usage field for requests using custom functions.
const zero = z.literal(0);
const zeroImageAndTextTokens = z.strictObject({ image_tokens: zero, text_tokens: zero });
const zeroHostedToolUsage = z
  .strictObject({
    image_gen: z.strictObject({
      input_tokens: zero,
      input_tokens_details: zeroImageAndTextTokens,
      output_tokens: zero,
      output_tokens_details: zeroImageAndTextTokens.optional(),
      total_tokens: zero,
      cached_tokens: zero.optional(),
      cached_tokens_details: z
        .strictObject({ cached_image_tokens: zero, cached_text_tokens: zero })
        .optional(),
    }),
    web_search: z.strictObject({ num_requests: zero }),
  })
  .optional();

const usageSchema = z.strictObject({
  input_tokens: inputCount,
  input_tokens_details: z.strictObject({
    cached_tokens: inputCount,
    cache_write_tokens: inputCount,
    cache_write_tokens_details: z
      .strictObject({ ttl_30m_tokens: inputCount, ttl_12h_tokens: inputCount })
      .optional(),
  }),
  output_tokens: outputCount,
  output_tokens_details: z.strictObject({ reasoning_tokens: outputCount }),
  total_tokens: z
    .number()
    .int()
    .min(0)
    .max(BUDGET_LIMITS.maxInputTokens + GENERATION_POLICY.max_output_tokens),
});

export function priceResponse(
  response: unknown
): { status: 'known'; microdollars: number } | { status: 'usage_unknown' | 'pricing_unknown' } {
  const envelope = responseSchema.safeParse(response);
  if (!envelope.success) return { status: 'usage_unknown' };

  const { model, service_tier, tool_usage, usage: responseUsage } = envelope.data;
  if (
    model !== RATE_CARD.model ||
    service_tier !== RATE_CARD.serviceTier ||
    !zeroHostedToolUsage.safeParse(tool_usage).success
  )
    return { status: 'pricing_unknown' };

  const parsed = usageSchema.safeParse(responseUsage);
  if (!parsed.success)
    return {
      status: parsed.error.issues.some(issue => issue.code === 'unrecognized_keys')
        ? 'pricing_unknown'
        : 'usage_unknown',
    };

  const usage = parsed.data;
  const { cached_tokens, cache_write_tokens, cache_write_tokens_details } =
    usage.input_tokens_details;
  const write30m = cache_write_tokens_details?.ttl_30m_tokens ?? 0;
  const write12h = cache_write_tokens_details?.ttl_12h_tokens ?? 0;
  const ordinaryInput = usage.input_tokens - cached_tokens - cache_write_tokens;

  // Absent lifetime details account for zero writes. A positive aggregate needs
  // both counters to establish its rates. Reasoning is included in output.
  if (
    ordinaryInput < 0 ||
    write30m + write12h !== cache_write_tokens ||
    usage.output_tokens_details.reasoning_tokens > usage.output_tokens ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens
  )
    return { status: 'usage_unknown' };

  const thousandthsOfMicrodollars =
    ordinaryInput * RATE_CARD.input +
    cached_tokens * RATE_CARD.cachedInput +
    write30m * RATE_CARD.cacheWrite30m +
    write12h * RATE_CARD.cacheWrite12h +
    usage.output_tokens * RATE_CARD.output;

  if (!Number.isSafeInteger(thousandthsOfMicrodollars)) return { status: 'pricing_unknown' };
  return {
    status: 'known',
    microdollars: Math.ceil(thousandthsOfMicrodollars / THOUSANDTHS_PER_MICRODOLLAR),
  };
}
