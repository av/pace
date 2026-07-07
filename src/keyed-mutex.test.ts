import { describe, test, expect } from "bun:test";
import { createKeyedMutex } from "./keyed-mutex";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Flush enough microtasks for withLock's internal awaits to settle. */
async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("createKeyedMutex", () => {
  test("returns fn result and propagates rejections", async () => {
    const mutex = createKeyedMutex();
    expect(await mutex.withLock(["a"], () => 42)).toBe(42);
    expect(mutex.withLock(["a"], async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
  });

  test("serializes holders of the same key in acquisition order", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const gate = deferred();

    const first = mutex.withLock(["k"], async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const second = mutex.withLock(["k"], () => {
      order.push("second");
    });

    await flushMicrotasks();
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  test("disjoint keys run concurrently", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const gate = deferred();

    const slow = mutex.withLock(["a"], async () => {
      await gate.promise;
      order.push("slow");
    });
    const fast = mutex.withLock(["b"], () => {
      order.push("fast");
    });

    await fast;
    expect(order).toEqual(["fast"]);
    gate.resolve();
    await slow;
    expect(order).toEqual(["fast", "slow"]);
  });

  test("multi-key holder blocks on every key and blocks later single-key holders", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const gate = deferred();

    const holderA = mutex.withLock(["a"], async () => {
      order.push("a-start");
      await gate.promise;
      order.push("a-end");
    });
    const multi = mutex.withLock(["b", "a"], () => {
      order.push("multi");
    });
    const holderB = mutex.withLock(["b"], () => {
      order.push("b");
    });

    await flushMicrotasks();
    // multi waits on "a"; holderB queues behind multi's claim on "b".
    expect(order).toEqual(["a-start"]);
    gate.resolve();
    await Promise.all([holderA, multi, holderB]);
    expect(order).toEqual(["a-start", "a-end", "multi", "b"]);
  });

  test("overlapping multi-key holders with different key order do not deadlock", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const gate = deferred();

    const first = mutex.withLock(["a", "b"], async () => {
      await gate.promise;
      order.push("first");
    });
    const second = mutex.withLock(["b", "a"], () => {
      order.push("second");
    });

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  test("releases the lock when fn throws", async () => {
    const mutex = createKeyedMutex();
    await expect(
      mutex.withLock(["k"], () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(await mutex.withLock(["k"], () => "after")).toBe("after");
  });

  test("duplicate keys in one call do not self-deadlock", async () => {
    const mutex = createKeyedMutex();
    expect(await mutex.withLock(["k", "k"], () => "ok")).toBe("ok");
  });
});
