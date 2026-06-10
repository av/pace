/** Write user-facing CLI stdout (help, version, preset list, validation help). */
export function writeCliStdout(message: string): void {
  console.log(message);
}

/** Write user-facing CLI stderr (fatal errors, validation messages). */
export function writeCliStderr(message: string): void {
  console.error(message);
}