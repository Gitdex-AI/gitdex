import type { DeveloperRoleId } from "@/lib/developer-roles";

export type Role =
  | "product_manager"
  | "developer"
  | "qa"
  | "architect"
  | "devops";

export type WorkflowStatus =
  | "created"
  | "ready_for_architect"
  | "planned"
  | "transferred_to_github"
  | "in_progress"
  | "blocked"
  | "done";
export type AgentSessionStatus = "active" | "blocked" | "done";
export type AgentMessageRole = "user" | "assistant" | "system";
export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type JobType = "workflow_run" | "issue_run" | "qa_run" | "architect_review_run" | "merge_run";

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
  githubUsername: string;
  githubSshPrivateKeyPath: string;
  githubSshPublicKey: string;
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
  branch: string;
  prUrl: string;
  changedFiles: string[];
  testsRun: string[];
  executionLog?: string;
};

export type ArchitectPrReviewDecision = "need_qa" | "ready_to_merge" | "changes_requested" | "merged" | "blocked";

export type ArchitectPrReviewResult = {
  decision: ArchitectPrReviewDecision;
  summary: string;
  labelsApplied: string[];
  comments: string[];
  executionLog?: string;
};

export type QaPrReviewResult = {
  passed: boolean;
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
  counts: Record<ProjectTriageGroup, number>;
  groups: Record<ProjectTriageGroup, ProjectTriageItem[]>;
};

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  createdAt: string;
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
  };
  payload: {
    workflowId: string;
    issueId?: string | null;
    prUrl?: string | null;
    branch?: string | null;
    headSha?: string | null;
    qaAttempt?: number | null;
    returnedFromQa?: boolean | null;
    previousPrUrl?: string | null;
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
