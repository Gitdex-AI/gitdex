import type { ArchitectPrReviewResult } from "@/lib/types";

export type LabelPlan = {
  decision: "ready_to_merge" | "blocked" | "changes_requested";
  summary: string;
  labelsApplied: string[];
  labelsRemoved: string[];
  comments: string[];
};

export function expectedDeveloperBranch(workflowCode: string, issueNumberOrId: number | string): string {
  return `taskix/${workflowCode}-issue-${issueNumberOrId}`;
}

export function prRecoveryBranches(input: {
  developerBranch?: string | null;
  workflowCode: string;
  issueNumberOrId: number | string;
}): string[] {
  return [
    input.developerBranch?.trim() || "",
    expectedDeveloperBranch(input.workflowCode, input.issueNumberOrId)
  ].filter(uniqueNonEmpty);
}

export function manualDeployFinalLabelPlan(input: {
  prUrl: string;
  architectDecision: ArchitectPrReviewResult;
}): LabelPlan {
  if (input.architectDecision.decision !== "ready_to_merge") {
    return {
      decision: input.architectDecision.decision === "changes_requested" ? "changes_requested" : "blocked",
      summary: input.architectDecision.summary,
      labelsApplied: [...new Set([...input.architectDecision.labelsApplied, "taskix:blocked"])],
      labelsRemoved: ["taskix:qa-running", "taskix:ready-to-merge"],
      comments: input.architectDecision.comments
    };
  }

  return {
    decision: "ready_to_merge",
    summary: `${input.architectDecision.summary}\n\nManual-deploy project: architect approved merge readiness after QA; Taskix marked ${input.prUrl} ready to merge without merging it.`,
    labelsApplied: [...new Set([...input.architectDecision.labelsApplied, "taskix:ready-to-merge"])],
    labelsRemoved: ["taskix:need-qa", "taskix:qa-running", "taskix:blocked"],
    comments: input.architectDecision.comments
  };
}

export function manualDeployArchitectPolicyDecision(input: {
  prUrl: string;
  qaPassed: boolean;
  prState?: string | null;
  prMerged?: boolean;
}): ArchitectPrReviewResult {
  const state = input.prState?.toUpperCase() ?? "OPEN";
  if (!input.qaPassed) {
    return {
      decision: "blocked",
      summary: `Architect policy blocked ${input.prUrl}: QA has not passed.`,
      labelsApplied: [],
      comments: []
    };
  }
  if (input.prMerged || state === "MERGED") {
    return {
      decision: "blocked",
      summary: `Architect policy blocked ${input.prUrl}: PR is already merged.`,
      labelsApplied: [],
      comments: []
    };
  }
  if (state !== "OPEN") {
    return {
      decision: "blocked",
      summary: `Architect policy blocked ${input.prUrl}: PR state is ${state}.`,
      labelsApplied: [],
      comments: []
    };
  }
  return {
    decision: "ready_to_merge",
    summary: `Architect policy approved ${input.prUrl} after QA passed; manual deployment keeps the PR open for human merge.`,
    labelsApplied: [],
    comments: []
  };
}

function uniqueNonEmpty(value: string, index: number, values: string[]): boolean {
  return Boolean(value) && values.indexOf(value) === index;
}
