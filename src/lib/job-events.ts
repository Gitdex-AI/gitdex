import { EventEmitter } from "node:events";
import type { JobRecord } from "@/lib/types";

type JobEvent = {
  projectId: string | null;
  job: JobRecord;
};

const globalForJobEvents = globalThis as typeof globalThis & {
  taskixJobEvents?: EventEmitter;
};

const jobEvents = globalForJobEvents.taskixJobEvents ?? new EventEmitter();
jobEvents.setMaxListeners(200);
globalForJobEvents.taskixJobEvents = jobEvents;

export function publishJobEvent(job: JobRecord): void {
  jobEvents.emit("job", {
    projectId: job.projectId ?? null,
    job
  } satisfies JobEvent);
}

export function subscribeProjectJobEvents(projectId: string, listener: (job: JobRecord) => void): () => void {
  const wrapped = (event: JobEvent) => {
    if (event.projectId !== projectId) return;
    listener(event.job);
  };
  jobEvents.on("job", wrapped);
  return () => jobEvents.off("job", wrapped);
}
