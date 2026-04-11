import { readFile } from "node:fs/promises";

import type { Logger } from "../logger.js";
import type { KillSwitchStatus } from "../types.js";

export class KillSwitchMonitor {
  public constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  public async readStatus(): Promise<KillSwitchStatus> {
    try {
      const raw = (await readFile(this.filePath, "utf8")).trim();
      if (!raw) {
        return { triggered: false, reason: null };
      }

      if (["1", "true", "stop"].includes(raw.toLowerCase())) {
        return { triggered: true, reason: "manual_kill_switch" };
      }

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.stop === true || parsed.triggered === true) {
        return {
          triggered: true,
          reason: typeof parsed.reason === "string" ? parsed.reason : "manual_kill_switch",
        };
      }

      return { triggered: false, reason: null };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { triggered: false, reason: null };
      }

      this.logger.warn("Ignoring malformed kill switch file", {
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { triggered: false, reason: null };
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
