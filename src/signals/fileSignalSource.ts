import { readFile } from "node:fs/promises";

import { parseSignalSnapshot } from "../contracts/signalSnapshot.js";
import type { Logger } from "../logger.js";
import type { SignalSnapshot } from "../types.js";

export class FileSignalSource {
  public constructor(
    private readonly signalFilePath: string,
    private readonly maxAgeMs: number,
    private readonly logger: Logger,
  ) {}

  public async read(targetMarketId: string, now = Date.now()): Promise<SignalSnapshot | null> {
    try {
      const raw = await readFile(this.signalFilePath, "utf8");
      const parsed = parseSignalSnapshot(JSON.parse(raw));

      if (parsed.marketId !== targetMarketId) {
        this.logger.warn("Ignoring cross-market signal", {
          targetMarketId,
          signalMarketId: parsed.marketId,
        });
        return null;
      }

      if (now - parsed.timestamp > this.maxAgeMs) {
        this.logger.warn("Ignoring stale signal", {
          signalTimestamp: parsed.timestamp,
          maxAgeMs: this.maxAgeMs,
        });
        return null;
      }

      return parsed;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      this.logger.warn("Ignoring malformed signal file", {
        signalFilePath: this.signalFilePath,
        error: formatError(error),
      });
      return null;
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
