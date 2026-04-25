import { createFileRoute } from "@tanstack/react-router";

import { loadResearchBootstrap } from "@/lib/research-bootstrap";
import { getResearchHub } from "@/lib/research-hub";
import type { ResearchWorkbenchStreamState } from "@/lib/research-types";
import type { ResearchDashboardState } from "@poly/trader-core/research/evaluation";

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

interface SseSink {
  send: (chunk: Uint8Array) => void;
  close: () => void;
}

type SseStartFn = (sink: SseSink) => (() => void) | void;

function encodeEvent(name: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function createSseResponse(start: SseStartFn): Response {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let userCleanup: (() => void) | null = null;
  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    userCleanup?.();
    userCleanup = null;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sink: SseSink = {
        send: (chunk) => controller.enqueue(chunk),
        close: () => {
          dispose();
          try {
            controller.close();
          } catch {
            // already closed; ignore
          }
        },
      };

      controller.enqueue(encoder.encode(": research stream ready\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          dispose();
        }
      }, HEARTBEAT_INTERVAL_MS);

      const maybeCleanup = start(sink);
      if (typeof maybeCleanup === "function") {
        userCleanup = maybeCleanup;
      }
    },
    cancel: dispose,
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function snapshotEvent(payload: ResearchWorkbenchStreamState): Uint8Array {
  return encodeEvent("snapshot", payload);
}

export function handleLiveStreamRequest(): Response {
  const bootstrap = loadResearchBootstrap();

  if (bootstrap.mode === "setup_required") {
    const { state } = bootstrap;
    return createSseResponse((sink) => {
      sink.send(snapshotEvent({ mode: "setup_required", state }));
    });
  }

  const hub = getResearchHub(bootstrap.config);
  return createSseResponse((sink) => {
    const sendState = (state: ResearchDashboardState) => {
      try {
        sink.send(snapshotEvent({ mode: "streaming", state }));
      } catch {
        sink.close();
      }
    };

    const unsubscribe = hub.subscribe(sendState);

    hub.ensureStarted().catch((error: unknown) => {
      try {
        sink.send(
          encodeEvent("error", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } catch {
        // controller already closed
      }
      sink.close();
    });

    return unsubscribe;
  });
}

export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: () => handleLiveStreamRequest(),
    },
  },
});
