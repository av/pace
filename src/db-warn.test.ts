import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnDb, warnDbClose } from "./db-warn";

describe("db warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnDb prefixes message with db module name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnDb("custom operational warning");
    expect(warnSpy).toHaveBeenCalledWith("db: custom operational warning");
  });

  test("warnDbClose includes error detail from errorMessage", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnDbClose(new Error("switch close fail"));
    expect(warnSpy).toHaveBeenCalledWith("db: failed to close: switch close fail");
  });
});