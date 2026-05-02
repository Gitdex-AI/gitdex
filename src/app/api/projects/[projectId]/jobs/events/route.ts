import { subscribeProjectJobEvents } from "@/lib/job-events";
import { getProject, listJobs } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const project = await getProject(projectId);
  if (!project) return new Response("Project not found.", { status: 404 });

  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      safeEnqueue(encodeEvent("snapshot", { jobs: await listJobs(project.projectId) }));
      const unsubscribe = subscribeProjectJobEvents(project.projectId, (job) => {
        safeEnqueue(encodeEvent("job", { job }));
      });
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": heartbeat\n\n"));
      }, 25000);

      cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    }
  });
}
