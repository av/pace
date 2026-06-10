import { expect, spyOn } from "bun:test";
import * as utilsMod from "../utils";

export type ErrorMessageSpy = ReturnType<typeof spyOn<typeof utilsMod, "errorMessage">>;

export type ErrorMessageSpyExpect =
  | "called"
  | { times: number }
  | { message: string };

/** Spy utils.errorMessage; restores in finally. */
export async function withErrorMessageSpy<T>(
  fn: (spy: ErrorMessageSpy) => T | Promise<T>,
): Promise<T> {
  const emSpy = spyOn(utilsMod, "errorMessage");
  try {
    return await fn(emSpy);
  } finally {
    emSpy.mockRestore();
  }
}

export function assertErrorMessageSpy(
  emSpy: ErrorMessageSpy,
  spyExpect: ErrorMessageSpyExpect,
): void {
  if (spyExpect === "called") {
    expect(emSpy).toHaveBeenCalled();
    return;
  }
  if ("times" in spyExpect) {
    expect(emSpy).toHaveBeenCalledTimes(spyExpect.times);
    return;
  }
  expect(emSpy).toHaveBeenCalledWith({ message: spyExpect.message });
}

/** Assert sync throw routes failure through utils.errorMessage. */
export async function expectThrowUsesErrorMessage(
  fn: () => unknown,
  throwMatcher: RegExp | string,
  spyExpect: ErrorMessageSpyExpect = "called",
): Promise<void> {
  await withErrorMessageSpy((emSpy) => {
    expect(fn).toThrow(throwMatcher);
    assertErrorMessageSpy(emSpy, spyExpect);
  });
}