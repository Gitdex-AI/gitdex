import { EventEmitter } from "node:events";
import type { JobRecord } from "@/lib/types";

type JobEvent = {
  projectId: string | null;
  job: JobRecord;
};

const globalForJobEvents = globalThis as typeof globalThis & {
  gitdexJobEvents?: EventEmitter;
};

const jobEvents = globalForJobEvents.gitdexJobEvents ?? new EventEmitter();
jobEvents.setMaxListeners(200);
globalForJobEvents.gitdexJobEvents = jobEvents;

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
