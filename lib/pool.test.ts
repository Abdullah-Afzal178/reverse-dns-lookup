import assert from "node:assert/strict";

import { mapWithLimit, withDeadline } from "@/lib/pool";

let checks = 0;
function check(actual: unknown, expected: unknown, message: string) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Order is kept even when later items finish first.
check(
  await mapWithLimit([30, 5, 20, 1], 4, async (ms, index) => {
    await delay(ms);
    return index;
  }),
  [0, 1, 2, 3],
  "results come back in input order",
);

// Never more than the limit in flight.
{
  let active = 0;
  let peak = 0;
  await mapWithLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(5);
    active -= 1;
  });
  check(peak, 3, "concurrency never exceeds the limit");
}

check(await mapWithLimit([], 4, async () => 1), [], "an empty list resolves to an empty list");
check(await mapWithLimit([1, 2], 0, async (n) => n * 2), [2, 4], "a zero limit still makes progress");
check(await mapWithLimit([1, 2, 3], 10, async (n) => n + 1), [2, 3, 4], "a limit above the length is fine");


// --- deadlines ---------------------------------------------------------
check(await withDeadline(() => delay(5).then(() => "work"), Date.now() + 200, () => "late"), "work", "fast work wins");
check(await withDeadline(() => delay(300).then(() => "work"), Date.now() + 60, () => "late"), "late", "slow work is abandoned at the deadline");
check(await withDeadline(() => delay(1).then(() => "work"), Date.now() + 10, () => "late"), "late", "work is not started with too little time left to finish");
check(await withDeadline(() => delay(5).then(() => "work"), Date.now() - 1, () => "late"), "late", "an expired deadline answers at once");
{
  const started = Date.now();
  await withDeadline(() => delay(2000), Date.now() + 40, () => undefined);
  check(Date.now() - started < 500, true, "waiting stops at the deadline, not when the work ends");
}
{
  // Items queued behind the limit must not start new work after the deadline.
  const deadline = Date.now() + 40;
  let started = 0;
  const results = await mapWithLimit([1, 2, 3, 4, 5, 6], 2, (n) =>
    withDeadline(() => { started += 1; return delay(30).then(() => `done-${n}`); }, deadline, () => `late-${n}`),
  );
  check(results.slice(0, 2), ["done-1", "done-2"], "the first wave finishes in time");
  check(results.slice(2).every((r) => r.startsWith("late")), true, "later waves are cut off, not left running the clock");
  check(started <= 4, true, "work queued after the deadline is never started");
}
{
  // The reviewed bug: with the deadline already gone, nothing may start.
  let ran = false;
  await withDeadline(() => { ran = true; return delay(1); }, Date.now() - 5, () => undefined);
  check(ran, false, "an expired deadline starts no work at all");
}

console.log(`pool: ${checks} assertions passed`);
