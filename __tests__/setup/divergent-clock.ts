/**
 * Runs `fn` with a clock that advances a millisecond on every `new Date()`.
 *
 * `audit.created_at` and `audit.updated_at` are populated by two independent clock
 * reads, so on a loaded machine they can land in different milliseconds. This forces
 * that interleaving deterministically instead of waiting for it to happen by chance.
 */
export async function withDivergentClock<T>(fn: () => T | Promise<T>): Promise<T> {
  const RealDate = global.Date;
  let tick = 0;

  class DivergentDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(RealDate.now() + tick);
        tick += 1;
        // Spread forwards every argument at runtime; the cast just picks an overload.
      } else super(...(args as [number]));
    }
  }

  global.Date = DivergentDate as DateConstructor;
  try {
    return await fn();
  } finally {
    global.Date = RealDate;
  }
}
