// Loaded before every test file (bunfig.toml [test] preload).
//
// CLI tests spawn `bun src/cli.ts` and compare its stderr byte for byte. Some
// agent sandboxes export FORCE_COLOR / CLICOLOR_FORCE, which makes Bun wrap
// console output in ANSI escapes in those child processes. Clear them so the
// children print plain text, as they do in CI and a normal terminal.
for (const key of ["FORCE_COLOR", "CLICOLOR_FORCE"]) {
  delete process.env[key];
}
