import type { ArchitectPrReviewResult } from "@/lib/types";

export type LabelPlan = {
  decision: "ready_to_merge" | "blocked" | "changes_requested";
  summary: string;
  labelsApplied: string[];
  labelsRemoved: string[];
  comments: string[];
};

export function expectedDeveloperBranch(workflowCode: string, issueNumberOrId: number | string): string {
  return `gitdex/${workflowCode}-issue-${issueNumberOrId}`;
}

export function expectedDeveloperBaseBranch(): string {
  return "main";
}

export function isRecoverablePrBase(baseBranch: string | null | undefined, expectedBaseBranch = expectedDeveloperBaseBranch()): boolean {
  return baseBranch === expectedBaseBranch;
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
      labelsApplied: [...new Set([...input.architectDecision.labelsApplied, "gd:fix"])],
      labelsRemoved: ["gd:review", "gd:merge"],
      comments: input.architectDecision.comments
    };
  }

  return {
    decision: "ready_to_merge",
    summary: `${input.architectDecision.summary}\n\nReviewer passed this PR. It is ready for the dedicated merge step. Manual deployment only controls post-merge deployment and does not block merging.`,
    labelsApplied: [...new Set([...input.architectDecision.labelsApplied, "gd:merge"])],
    labelsRemoved: ["gd:qa", "gd:review", "gd:blocked"],
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
    summary: `Architect policy approved ${input.prUrl} after QA passed; it is ready for the dedicated merge step. Manual deployment controls post-merge deployment only.`,
    labelsApplied: [],
    comments: []
  };
}

function uniqueNonEmpty(value: string, index: number, values: string[]): boolean {
  return Boolean(value) && values.indexOf(value) === index;
}
