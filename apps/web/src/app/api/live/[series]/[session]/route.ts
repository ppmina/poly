import {
  createProviderFeedAdapter,
  createReplayFeedAdapter,
  getSessionDefinition,
  isSeriesId,
} from "@poly/motorsport-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(name: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function createAdapter() {
  return process.env.LIVE_FEED_MODE === "provider"
    ? createProviderFeedAdapter()
    : createReplayFeedAdapter();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ series: string; session: string }> },
) {
  const { series, session } = await context.params;

  if (!isSeriesId(series) || !getSessionDefinition(series, session)) {
    return new Response("Unknown series or session", { status: 404 });
  }

  const adapter = createAdapter();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(": liveline stream ready\n\n"));

      try {
        for await (const snapshot of adapter.streamSession({
          seriesId: series,
          sessionId: session,
          signal: request.signal,
        })) {
          controller.enqueue(encodeEvent("snapshot", snapshot));
        }
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(
            encodeEvent("error", {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      } finally {
        if (!request.signal.aborted) {
          controller.close();
        }
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
