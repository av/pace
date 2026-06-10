import { describe, test, expect, spyOn } from "bun:test";
import { logServerListening } from "./server-log";

describe("server log utilities", () => {
  test("logServerListening reports bind URL with port", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    logServerListening(7453);
    expect(logSpy).toHaveBeenCalledWith("index: listening on http://localhost:7453");
    logSpy.mockRestore();
  });
});