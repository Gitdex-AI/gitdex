import type { WorkflowRecord } from "@/lib/types";

export function isReusableDraftWorkflow(projectId: string, workflow: WorkflowRecord): boolean {
  return workflow.projectId === projectId
    && !workflow.trackingCode
    && workflow.status === "created"
    && workflow.issues.length === 0;
}

export function isDiscardableDraftWorkflow(projectId: string, workflow: WorkflowRecord): boolean {
  return isReusableDraftWorkflow(projectId, workflow);
}

export function latestReusableDraftWorkflow(projectId: string, workflows: WorkflowRecord[]): WorkflowRecord | null {
  return workflows
    .filter((workflow) => isReusableDraftWorkflow(projectId, workflow))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
