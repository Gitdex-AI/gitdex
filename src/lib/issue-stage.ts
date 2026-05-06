import type { IssueRecord, JobRecord } from "./types.ts";

export const issueStageLabels = [
  "gd:dev",
  "gd:fix",
  "gd:rebase",
  "gd:qa",
  "gd:review",
  "gd:merge",
  "gd:architect",
  "gd:blocked",
  "gd:done"
] as const;

export type IssueStage = typeof issueStageLabels[number];

export const legacyWorkflowLabels = [
  "qa-passed",
  "qa-failed",
  "qa-running",
  "gitdex:dev-running",
  "gitdex:architect-review",
  "gitdex:need-qa",
  "gitdex:qa-running",
  "gitdex:qa-passed",
  "gitdex:qa-failed",
  "gitdex:env-blocked",
  "gitdex:spec-blocked",
  "gitdex:ready-to-merge",
  "gitdex:needs-rebase",
  "gitdex:merged",
  "gitdex:deployed",
  "gitdex:blocked"
] as const;

export const workflowStateLabels = [...issueStageLabels, ...legacyWorkflowLabels] as const;
const prLabelsToClear = [
  ...workflowStateLabels,
  "role:backend_developer",
  "role:web_developer",
  "role:app_developer",
  "role:admin_developer",
  "role:devops_developer",
  "role:data_developer",
  "role:general_developer"
];

export type IssueAction = "run_dev" | "run_qa" | "run_review" | "run_merge" | "run_architect" | "resolve" | "none";

const stagePriority: IssueStage[] = [
  "gd:done",
  "gd:blocked",
  "gd:architect",
  "gd:rebase",
  "gd:fix",
  "gd:merge",
  "gd:review",
  "gd:qa",
  "gd:dev"
];

const legacyStageMap: Record<string, IssueStage> = {
  "qa-passed": "gd:review",
  "qa-failed": "gd:fix",
  "qa-running": "gd:qa",
  "gitdex:dev-running": "gd:dev",
  "gitdex:architect-review": "gd:review",
  "gitdex:need-qa": "gd:qa",
  "gitdex:qa-running": "gd:qa",
  "gitdex:qa-passed": "gd:review",
  "gitdex:qa-failed": "gd:fix",
  "gitdex:env-blocked": "gd:blocked",
  "gitdex:spec-blocked": "gd:architect",
  "gitdex:ready-to-merge": "gd:merge",
  "gitdex:needs-rebase": "gd:rebase",
  "gitdex:merged": "gd:done",
  "gitdex:deployed": "gd:done",
  "gitdex:blocked": "gd:blocked"
};

export function getIssueStage(issue: Pick<IssueRecord, "labels" | "githubState" | "prUrl" | "prState">): IssueStage {
  return deriveIssueStage({
    labels: issue.labels ?? [],
    githubState: issue.githubState ?? null,
    prUrl: issue.prUrl ?? null,
    prState: issue.prState ?? null
  }).stage;
}

export function deriveIssueStage(input: {
  labels: string[];
  githubState?: string | null;
  prUrl?: string | null;
  prState?: string | null;
}): { stage: IssueStage; removeLabels: string[]; addLabels: string[]; conflicted: boolean; migrated: boolean } {
  const normalized = input.labels.map((label) => label.toLowerCase());
  const existingStages = normalized.filter((label): label is IssueStage => isIssueStage(label));
  const legacyStages = normalized
    .map((label) => legacyStageMap[label])
    .filter((stage): stage is IssueStage => Boolean(stage));
  let stage = chooseStage([...existingStages, ...legacyStages]);

  if (input.prState === "MERGED" || input.githubState === "CLOSED") {
    stage = "gd:done";
  } else if (!stage) {
    stage = input.prUrl || input.prState === "OPEN" ? "gd:qa" : "gd:dev";
  }

  const workflowSet = new Set<string>(workflowStateLabels);
  const removeLabels = input.labels.filter((label) => workflowSet.has(label.toLowerCase()) && label.toLowerCase() !== stage);
  const hasStage = normalized.includes(stage);
  const addLabels = hasStage ? [] : [stage];
  return {
    stage,
    removeLabels,
    addLabels,
    conflicted: existingStages.length + legacyStages.length > 1,
    migrated: legacyStages.length > 0 || !hasStage
  };
}

export function deriveIssueAction(issue: IssueRecord, jobs: JobRecord[] = []): {
  stage: IssueStage;
  action: IssueAction;
  runningJob: JobRecord | null;
  pendingJob: JobRecord | null;
} {
  const stage = getIssueStage(issue);
  const activeJobs = jobs.filter((job) => isIssueJobForIssue(job, issue.issueId) && (job.status === "pending" || job.status === "running"));
  const runningJob = activeJobs.find((job) => job.status === "running") ?? null;
  const pendingJob = activeJobs.find((job) => job.status === "pending") ?? null;
  return {
    stage,
    action: actionForStage(stage),
    runningJob,
    pendingJob
  };
}

export async function repairIssueStageLabels(input: {
  repo: string;
  issue: IssueRecord;
  prUrl?: string | null;
}): Promise<IssueStage> {
  const { addLabelsWithGh, removeLabelsWithGh } = await import("@/lib/github-local");
  const repair = deriveIssueStage({
    labels: input.issue.labels ?? [],
    githubState: input.issue.githubState ?? null,
    prUrl: input.prUrl ?? input.issue.prUrl ?? null,
    prState: input.issue.prState ?? null
  });
  if (input.issue.githubIssueNumber) {
    if (repair.removeLabels.length) await removeLabelsWithGh(input.repo, input.issue.githubIssueNumber, repair.removeLabels);
    if (repair.addLabels.length) await addLabelsWithGh(input.repo, input.issue.githubIssueNumber, repair.addLabels);
  }
  if (input.prUrl) await removeLabelsWithGh(input.repo, input.prUrl, prLabelsToClear);
  input.issue.labels = applyStageLabels(input.issue.labels ?? [], repair.stage);
  input.issue.prLabels = [];
  return repair.stage;
}

export async function transitionIssueStage(input: {
  repo: string;
  issue: IssueRecord;
  stage: IssueStage;
  prUrl?: string | null;
}): Promise<void> {
  const { addLabelsWithGh, removeLabelsWithGh } = await import("@/lib/github-local");
  if (input.issue.githubIssueNumber) {
    await removeLabelsWithGh(input.repo, input.issue.githubIssueNumber, [...workflowStateLabels].filter((label) => label !== input.stage));
    await addLabelsWithGh(input.repo, input.issue.githubIssueNumber, [input.stage]);
  }
  const prUrl = input.prUrl ?? input.issue.prUrl ?? null;
  if (prUrl) await removeLabelsWithGh(input.repo, prUrl, prLabelsToClear);
  input.issue.labels = applyStageLabels(input.issue.labels ?? [], input.stage);
  input.issue.prLabels = [];
}

export function applyStageLabels(labels: string[], stage: IssueStage): string[] {
  const workflowSet = new Set<string>(workflowStateLabels);
  return [...new Set([...labels.filter((label) => !workflowSet.has(label.toLowerCase())), stage])];
}

export function actionForStage(stage: IssueStage): IssueAction {
  if (stage === "gd:dev" || stage === "gd:fix" || stage === "gd:rebase") return "run_dev";
  if (stage === "gd:qa") return "run_qa";
  if (stage === "gd:review") return "run_review";
  if (stage === "gd:merge") return "run_merge";
  if (stage === "gd:architect") return "run_architect";
  if (stage === "gd:blocked") return "resolve";
  return "none";
}

export function isIssueStage(label: string): label is IssueStage {
  return (issueStageLabels as readonly string[]).includes(label);
}

function chooseStage(stages: IssueStage[]): IssueStage | null {
  if (!stages.length) return null;
  const unique = new Set(stages);
  return stagePriority.find((stage) => unique.has(stage)) ?? stages[0] ?? null;
}

function isIssueJobForIssue(job: JobRecord, issueId: string): boolean {
  return ["issue_run", "qa_run", "blocker_analysis_run", "architect_blocker_run", "architect_review_run", "merge_run"].includes(job.type) && job.payload.issueId === issueId;
}
