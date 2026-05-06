import type { DeveloperRoleId } from "@/lib/developer-roles";

export type Role =
  | "product_manager"
  | "planner"
  | "developer"
  | "qa"
  | "architect"
  | "reviewer"
  | "devops";

export type WorkflowStatus =
  | "created"
  | "ready_for_planner"
  | "planned"
  | "transferred_to_github"
  | "in_progress"
  | "blocked"
  | "done";
export type AgentSessionStatus = "active" | "blocked" | "done";
export type AgentMessageRole = "user" | "assistant" | "system";
export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type JobType = "memory_init" | "workflow_run" | "issue_run" | "qa_run" | "blocker_analysis_run" | "architect_blocker_run" | "architect_review_run" | "merge_run";

export type Settings = {
  appBaseUrl: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  codexBin: string;
  codexHome: string;
  codexModel: string;
  codexSandbox: string;
  codexApprovalPolicy: string;
  githubToken: string;
  githubRepo: string;
  githubApiUrl: string;
  worktreeRetentionDays: number;
  autoCleanupCompletedWorktrees: boolean;
  rebuildWorktreeOnEnvironmentBlocked: boolean;
};

export type IssueSpec = {
  title: string;
  description: string;
  assigneeRole: Role;
  developerRole?: DeveloperRoleId;
  ownedPaths: string[];
  acceptanceCriteria: string[];
  dependsOn?: string[];
  parallelGroup?: string | null;
  executionOrder?: number | null;
};

export type IssueRecord = IssueSpec & {
  issueId: string;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  prUrl?: string | null;
  branch?: string | null;
  labels?: string[];
  prLabels?: string[];
  githubState?: string | null;
  prState?: string | null;
  developerSessionId?: string | null;
  qaSessionId?: string | null;
};

export type DeveloperResult = {
  summary: string;
  implementationNotes: string[];
  prTitle: string;
  prBody: string;
};

export type DeveloperIssueResult = {
  summary: string;
  blockedType: "none" | "implementation" | "spec" | "environment";
  branch: string;
  prUrl: string;
  changedFiles: string[];
  testsRun: string[];
  executionLog?: string;
};

export type ArchitectPrReviewDecision = "need_qa" | "ready_to_merge" | "changes_requested" | "needs_developer_rebase" | "merged" | "blocked";

export type ArchitectPrReviewResult = {
  decision: ArchitectPrReviewDecision;
  summary: string;
  labelsApplied: string[];
  comments: string[];
  executionLog?: string;
};

export type ReviewerMergeDecision = "merged" | "needs_developer_rebase" | "blocked";

export type ReviewerMergeResult = {
  decision: ReviewerMergeDecision;
  summary: string;
  blocker: string;
  executionLog?: string;
};

export type BlockerAnalysisResult = {
  blockerType: "environment" | "spec" | "implementation" | "merge_conflict" | "permission" | "unknown";
  summary: string;
  recommendedAction: "reset_to_dev" | "run_architect" | "fix_environment" | "manual_review" | "close_issue";
  userExplanation: string;
  risks: string[];
  executionLog?: string;
};

export type QaPrReviewResult = {
  passed: boolean;
  failureType: "none" | "implementation" | "spec" | "environment" | "stale";
  summary: string;
  findings: string[];
  labelsApplied: string[];
  testsRun: string[];
  executionLog?: string;
};

export type QaResult = {
  passed: boolean;
  summary: string;
  findings: string[];
  followUpIssue?: IssueSpec | null;
};

export type ArchitectReviewResult = {
  approved: boolean;
  summary: string;
  mergePlan: string;
  deploymentPlan: string;
  risks: string[];
};

export type WorkflowRecord = {
  workflowId: string;
  trackingCode?: string | null;
  userRequirement: string;
  status: WorkflowStatus;
  chatId: number;
  createdAt: string;
  paused?: boolean;
  pausedAt?: string | null;
  archivedAt?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  issues: IssueRecord[];
  timeline: string[];
};

export type ProjectRecord = {
  projectId: string;
  name: string;
  slug: string;
  githubRepo: string;
  githubAccount: string;
  githubAccessToken: string;
  autoDeploy: boolean;
  agentsFilePath: string;
  updateAgentsFile: boolean;
  projectManagerSessionId?: string | null;
  architectSessionId?: string | null;
  devopsSessionId?: string | null;
  createdAt: string;
  teamRoles: Role[];
};

export type ProjectTriageGroup = "blocked" | "needs_qa" | "ready_to_merge" | "in_progress" | "done" | "untracked";

export type ProjectTriageItem = {
  issueNumber: number;
  issueUrl: string;
  issueState: string;
  issueLabels: string[];
  primaryLinkedPrUrl: string | null;
  primaryLinkedPrState: string | null;
  primaryLinkedPrLabels: string[];
  group: ProjectTriageGroup;
};

export type ProjectTriageResponse = {
  ok: true;
  projectId: string;
  repo: string;
  generatedAt: string;
  lastSyncedAt?: string | null;
  counts: Record<ProjectTriageGroup, number>;
  groups: Record<ProjectTriageGroup, ProjectTriageItem[]>;
};

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  createdAt: string;
  messageId?: string;
  jobId?: string | null;
  status?: "pending" | "running" | "done" | "blocked" | "failed" | "cancelled";
  updatedAt?: string | null;
  durationMs?: number | null;
  executionLogs?: AgentExecutionLog[];
};

export type AgentExecutionLog = {
  title: string;
  content: string;
  createdAt: string;
  status?: "ok" | "failed";
  durationMs?: number | null;
};

export type AgentSessionRecord = {
  sessionKey: string;
  projectId: string;
  role: Role;
  title: string;
  status: AgentSessionStatus;
  sessionId?: string | null;
  workflowId?: string | null;
  issueId?: string | null;
  developerRole?: DeveloperRoleId | null;
  ownedPaths?: string[];
  currentStep?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  prUrl?: string | null;
  labels?: string[];
  lastSyncedAt?: string | null;
  closedAt?: string | null;
  archivedAt?: string | null;
  messages: AgentMessage[];
  executionLogs?: AgentExecutionLog[];
  updatedAt: string;
};

export type JobRecord = {
  jobId: string;
  projectId?: string | null;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  error?: string | null;
  runtime?: {
    pid?: number | null;
    startedAt?: string | null;
    lastHeartbeatAt?: string | null;
    lastOutputAt?: string | null;
    outputTail?: string | null;
    outputBytes?: number | null;
    finishedAt?: string | null;
    agentFinalAt?: string | null;
    agentFinalStatus?: "pass" | "fail" | "blocked" | null;
    agentFinalSummary?: string | null;
  };
  payload: {
    workflowId: string;
    issueId?: string | null;
    prUrl?: string | null;
    branch?: string | null;
    headSha?: string | null;
    qaAttempt?: number | null;
    previewPort?: number | null;
    previewUrl?: string | null;
    returnedFromQa?: boolean | null;
    previousPrUrl?: string | null;
    sessionKey?: string | null;
    worktreeRecoveryAttempt?: number | null;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id?: number;
    text?: string;
    chat: { id: number };
  };
};
