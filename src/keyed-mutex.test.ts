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

  test("pendingKeyCount tracks held keys and returns to zero on release", async () => {
    const mutex = createKeyedMutex();
    expect(mutex.pendingKeyCount()).toBe(0);
    const gate = deferred();
    const holder = mutex.withLock(["a", "b"], () => gate.promise);
    expect(mutex.pendingKeyCount()).toBe(2);
    gate.resolve();
    await holder;
    expect(mutex.pendingKeyCount()).toBe(0);
  });

  test("soak: 500 overlapping cycles with rejections leave no pending keys", async () => {
    // Leak regression for long-running `pace serve`: the internal tail map
    // must not retain entries after holders settle - success or failure -
    // across many overlapping waves on a rotating key space.
    const mutex = createKeyedMutex();
    const keys = ["p1", "p2", "p3", "shared"];
    const waves: Promise<unknown>[] = [];
    for (let i = 0; i < 500; i++) {
      const lockKeys = [keys[i % keys.length], keys[(i + 1) % keys.length]];
      const work = mutex.withLock(lockKeys, async () => {
        await Promise.resolve();
        if (i % 7 === 0) throw new Error("soak reject");
        return i;
      });
      waves.push(work.catch(() => {}));
      if (i % 25 === 0) await Promise.all(waves);
    }
    await Promise.all(waves);
    expect(mutex.pendingKeyCount()).toBe(0);
  });
});
