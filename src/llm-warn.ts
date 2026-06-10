import { errorMessage } from "./utils";

const LLM_PREFIX = "llm";

/** Prefix a message with llm module name and log as warning. */
export function warnLlm(message: string, err?: unknown): void {
  console.warn(
    err !== undefined ? `${LLM_PREFIX}: ${message}: ${errorMessage(err)}` : `${LLM_PREFIX}: ${message}`,
  );
}