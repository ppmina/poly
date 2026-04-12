import { loadResearchBootstrap } from "@/lib/research-bootstrap";
import { getResearchHub } from "@/lib/research-hub";
import type { ResearchDashboardState } from "@poly/trader-core/research/evaluation";

import type { ResearchSetupState, ResearchWorkbenchStreamState } from "@/lib/research-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;

function encodeEvent(name: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function GET() {
  const bootstrap = loadResearchBootstrap();

  if (bootstrap.mode === "setup_required") {
    return createSetupRequiredResponse(bootstrap.state);
  }

  const hub = getResearchHub(bootstrap.config);
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  function cleanup(): void {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendState = (state: ResearchDashboardState) => {
        try {
          controller.enqueue(
            encodeEvent("snapshot", {
              mode: "streaming",
              state,
            } satisfies ResearchWorkbenchStreamState),
          );
        } catch {
          cleanup();
        }
      };

      controller.enqueue(encoder.encode(": research stream ready\n\n"));
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, HEARTBEAT_INTERVAL_MS);
      unsubscribe = hub.subscribe(sendState);

      try {
        await hub.ensureStarted();
      } catch (error) {
        controller.enqueue(
          encodeEvent("error", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        cleanup();
        controller.close();
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function createSetupRequiredResponse(state: ResearchSetupState): Response {
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": research stream ready\n\n"));
      controller.enqueue(
        encodeEvent("snapshot", {
          mode: "setup_required",
          state,
        } satisfies ResearchWorkbenchStreamState),
      );

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
