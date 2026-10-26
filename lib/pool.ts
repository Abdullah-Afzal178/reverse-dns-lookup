/**
 * Runs an async function over a list with at most `limit` in flight, keeping
 * results in input order. Pure: no I/O of its own.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));

  return results;
}

/**
 * Starts `work` and settles with `fallback()` if it has not finished by
 * `deadline` (an epoch millisecond). Work is passed as a function so that
 * nothing is started at all once the deadline has gone — items queued behind
 * the concurrency limit must not fire DNS queries whose answers are discarded.
 * Work already running is not cancelled; it just stops being waited for.
 */
export function withDeadline<T>(
  work: () => Promise<T>,
  deadline: number,
  fallback: () => T,
  now: () => number = Date.now,
  /**
   * Work is not started with less time than this left: it could not finish,
   * and timers firing a millisecond ahead of Date.now() would otherwise let
   * queued work slip in just as the deadline lands.
   */
  minimum = 25,
): Promise<T> {
  const remaining = deadline - now();

  if (remaining <= minimum) {
    return Promise.resolve(fallback());
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), remaining);
  });

  return Promise.race([work(), timeout]).finally(() => clearTimeout(timer));
}
