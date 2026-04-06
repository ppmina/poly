import type { Logger } from "../src/logger.js";

export function createNoopLogger(): Logger {
  return {
    child: () => createNoopLogger(),
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}
