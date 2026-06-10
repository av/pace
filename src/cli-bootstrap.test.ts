import { describe, test, expect, mock } from "bun:test";
import { bootstrapServeModule } from "./cli-help";

const cliConfigDeps = {
  resolvePreset: (name: string) => (name === "tech-news" ? "/presets/tech-news.yaml" : null),
  listPresets: () => ["tech-news"],
  tryReadRegularFile: () => "ok",
};

describe("bootstrapServeModule", () => {
  test("applies CLI env then invokes bootstrapServer (cli-help → bootstrapServer)", async () => {
    const bootstrapServer = mock(async () => {});
    const origConfig = process.env.PACE_CONFIG;
    const origPort = process.env.PORT;
    try {
      await bootstrapServeModule(
        { preset: "tech-news", port: "8123" },
        { ...cliConfigDeps, bootstrapServer },
      );

      expect(process.env.PACE_CONFIG).toBe("/presets/tech-news.yaml");
      expect(process.env.PORT).toBe("8123");
      expect(bootstrapServer).toHaveBeenCalledTimes(1);
      expect(bootstrapServer).toHaveBeenCalledWith();
    } finally {
      if (origConfig === undefined) delete process.env.PACE_CONFIG;
      else process.env.PACE_CONFIG = origConfig;
      if (origPort === undefined) delete process.env.PORT;
      else process.env.PORT = origPort;
    }
  });

  test("routes fatal bootstrap errors through cliDie", async () => {
    const bootstrapServer = mock(async () => {
      throw new Error("config: invalid layout");
    });

    let exitCode: number | undefined;
    let stderr = "";
    const origExit = process.exit;
    const origError = console.error;
    try {
      process.exit = ((code?: number) => {
        exitCode = code ?? 0;
        throw new Error("cliDie");
      }) as typeof process.exit;
      console.error = (msg: string) => {
        stderr = String(msg);
      };

      await expect(
        bootstrapServeModule(
          { port: "8124" },
          { ...cliConfigDeps, bootstrapServer },
        ),
      ).rejects.toThrow("cliDie");
      expect(exitCode).toBe(1);
      expect(stderr).toBe("config: invalid layout");
    } finally {
      process.exit = origExit;
      console.error = origError;
    }
  });

  test("re-throws non-fatal bootstrap errors", async () => {
    const bootstrapServer = mock(async () => {
      throw new Error("unexpected network failure");
    });

    await expect(
      bootstrapServeModule(
        { port: "8125" },
        { ...cliConfigDeps, bootstrapServer },
      ),
    ).rejects.toThrow("unexpected network failure");
  });
});