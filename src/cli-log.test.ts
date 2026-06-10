import { describe, test, expect } from "bun:test";
import { writeCliStderr, writeCliStdout } from "./cli-log";

describe("cli-log", () => {
  test("writeCliStdout and writeCliStderr route to console", () => {
    const lines: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    try {
      console.log = (msg: string) => {
        lines.push(`out:${msg}`);
      };
      console.error = (msg: string) => {
        lines.push(`err:${msg}`);
      };
      writeCliStdout("help text");
      writeCliStderr("bad port");
      expect(lines).toEqual(["out:help text", "err:bad port"]);
    } finally {
      console.log = origLog;
      console.error = origError;
    }
  });
});