import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "../logger.js";

export class JsonlArtifactStore {
  private readonly writeQueues = new Map<string, Promise<void>>();

  public constructor(
    private readonly baseDir: string,
    private readonly logger: Logger,
  ) {}

  public async append(stream: string, payload: unknown): Promise<void> {
    const filePath = this.streamPath(stream);
    await mkdir(this.baseDir, { recursive: true });

    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    });

    this.writeQueues.set(
      filePath,
      next.catch((error: unknown) => {
        this.logger.error("Failed to append artifact", {
          stream,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );

    await next;
  }

  public streamPath(stream: string): string {
    return join(this.baseDir, `${stream}.jsonl`);
  }
}
