import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexClient } from "@/lib/codex";
import { GitHubClient } from "@/lib/github";
import { addLabelsWithGh, createIssueWithGh, findPullRequestByHeadWithGh, getIssueSnapshotWithGh, removeLabelsWithGh } from "@/lib/github-local";
import { expectedDeveloperBranch, manualDeployArchitectPolicyDecision, manualDeployFinalLabelPlan, prRecoveryBranches } from "@/lib/issue-run-policy";
import { getSettings } from "@/lib/settings";
import { appendAgentMessages, createJob, listWorkflows, saveProject, saveWorkflow, getWorkflow } from "@/lib/store";
import type { IssueRecord, IssueSpec, ProjectRecord, WorkflowRecord } from "@/lib/types";

const execFileAsync = promisify(execFile);

export async function createWorkflow(requirement: string, chatId: number, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const createdAt = new Date().toISOString();
  const trackingCode = await nextWorkflowTrackingCode(createdAt);
  const workflow: WorkflowRecord = {
    workflowId: randomUUID().slice(0, 8),
    trackingCode,
    userRequirement: requirement,
    status: "created",
    chatId,
    createdAt,
    paused: false,
    pausedAt: null,
    projectId: project?.projectId ?? null,
    projectName: project?.name ?? null,
    issues: [],
    timeline: [project ? `Workflow ${trackingCode} created for project ${project.name}.` : `Workflow ${trackingCode} created.`]
  };
  await saveWorkflow(workflow);
  return workflow;
}

async function nextWorkflowTrackingCode(createdAt: string): Promise<string> {
  const day = createdAt.slice(0, 10).replace(/-/g, "");
  const prefix = `WF-${day}-`;
  const existing = await listWorkflows();
  const next = existing
    .map((workflow) => workflow.trackingCode ?? "")
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function runWorkflow(workflowId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const issueCreator = createIssueCreator(project, settings);

  const issues = await codex.architectPlanIssues(workflow.userRequirement);
  workflow.issues = [];
  workflow.status = "planned";
  workflow.timeline.push("PM confirmed scope and handed requirement to architect.");
  workflow.timeline.push("Architect generated implementation issue breakdown.");
  if (project?.projectId) {
    await appendAgentMessages({
      sessionKey: `${project.projectId}:architect`,
      projectId: project.projectId,
      role: "architect",
      title: "Architect",
      workflowId: workflow.workflowId,
      messages: [
        {
          role: "user",
          content: `PM handed off workflow ${displayWorkflowCode(workflow)}:\n\n${workflow.userRequirement}`,
          createdAt: new Date().toISOString()
        },
        {
          role: "assistant",
          content: `Architect planned ${issues.length} implementation issue(s):\n\n${issues.map((issue, index) => {
            const ownedPaths = issue.ownedPaths.length ? issue.ownedPaths.join(", ") : "unspecified";
            return `${index + 1}. ${issue.title}\nDeveloper role: ${issue.developerRole ?? issue.assigneeRole}\nOwned paths: ${ownedPaths}\nAcceptance criteria:\n${issue.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`;
          }).join("\n\n")}`,
          createdAt: new Date().toISOString()
        }
      ]
    });
  }

  for (const [index, issue] of issues.entries()) {
    const created = await issueCreator(issue);
    workflow.issues.push({
      ...issue,
      issueId: `${displayWorkflowCode(workflow)}-${index + 1}`,
      githubIssueNumber: created.number,
      githubIssueUrl: created.htmlUrl,
      developerSessionId: `${workflow.workflowId}-${index + 1}:developer`,
      qaSessionId: `${workflow.workflowId}-${index + 1}:qa`
    });
  }

  workflow.status = "planned";
  workflow.timeline.push(`Created ${workflow.issues.length} GitHub issue(s) with Taskix labels.`);
  if (project?.projectId) {
    for (const issue of workflow.issues) {
      await createJob({
        projectId: project.projectId,
        type: "issue_run",
        payload: { workflowId: workflow.workflowId, issueId: issue.issueId }
      });
    }
    workflow.timeline.push(`Queued ${workflow.issues.length} developer issue job(s). Use Run Jobs to start developer execution.`);
  } else {
    workflow.timeline.push("Developer issue jobs were not queued because this workflow is not bound to a project.");
  }

  await saveWorkflow(workflow);
  if (project) await saveProject(project);
  return workflow;
}

export async function runWorkflowIssue(workflowId: string, issueId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const settings = await getSettings();
  const codex = new CodexClient(settings);
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  const issue = workflow.issues.find((item) => item.issueId === issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found in workflow ${displayWorkflowCode(workflow)}`);

  workflow.status = "in_progress";
  workflow.timeline.push(`Retrying developer for issue ${issue.issueId}.`);
  await saveWorkflow(workflow);

  const result = await runIssue(issue, workflow, codex, createIssueCreator(project, settings), project);
  workflow.timeline.push(...result.timeline);
  workflow.status = deriveWorkflowStatus(workflow);
  if (result.blocked) workflow.status = "blocked";
  await saveWorkflow(workflow);
  if (project) await saveProject(project);
  return workflow;
}

export async function syncWorkflowFromGitHub(workflowId: string, project?: ProjectRecord | null): Promise<WorkflowRecord> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
  if (!project?.githubRepo) {
    workflow.timeline.push("GitHub sync skipped: workflow has no bound project repo.");
    await saveWorkflow(workflow);
    return workflow;
  }

  const before = JSON.stringify(workflow.issues.map((issue) => ({
    issueId: issue.issueId,
    labels: issue.labels,
    prUrl: issue.prUrl,
    prLabels: issue.prLabels,
    prState: issue.prState
  })));

  for (const issue of workflow.issues) {
    if (!issue.githubIssueNumber) continue;
    const snapshot = await getIssueSnapshotWithGh(project.githubRepo, issue.githubIssueNumber);
    const primaryPr = choosePrimaryPr(snapshot.linkedPrs);
    issue.githubIssueUrl = snapshot.url;
    issue.githubState = snapshot.state;
    issue.labels = snapshot.labels;
    issue.prUrl = primaryPr?.url ?? null;
    issue.prState = primaryPr?.state ?? null;
    issue.prLabels = primaryPr?.labels ?? [];
    const now = new Date().toISOString();
    if (workflow.projectId && issue.developerSessionId) {
      await appendAgentMessages({
        sessionKey: issue.developerSessionId,
        projectId: workflow.projectId,
        role: "developer",
        title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        developerRole: issue.developerRole ?? "general_developer",
        ownedPaths: issue.ownedPaths,
        githubIssueNumber: issue.githubIssueNumber,
        githubIssueUrl: snapshot.url,
        prUrl: primaryPr?.url ?? issue.prUrl ?? null,
        labels: [...snapshot.labels, ...(primaryPr?.labels ?? [])],
        lastSyncedAt: now,
        messages: []
      });
    }
    const combinedLabels = [...new Set([...snapshot.labels, ...(primaryPr?.labels ?? [])])];
    const qaStatus = deriveQaSessionStatus(combinedLabels);
    if (workflow.projectId && issue.qaSessionId && primaryPr && qaStatus) {
      const finishedAt = qaStatus === "active" ? null : now;
      await appendAgentMessages({
        sessionKey: issue.qaSessionId,
        projectId: workflow.projectId,
        role: "qa",
        title: `QA: ${issue.title}`,
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        ownedPaths: issue.ownedPaths,
        githubIssueNumber: issue.githubIssueNumber,
        githubIssueUrl: snapshot.url,
        prUrl: primaryPr.url,
        labels: combinedLabels,
        lastSyncedAt: now,
        status: qaStatus,
        currentStep: qaStatus === "done" ? "QA passed" : qaStatus === "blocked" ? "QA failed" : "QA validating PR",
        finishedAt,
        closedAt: qaStatus === "done" ? now : null,
        archivedAt: qaStatus === "done" ? now : null,
        messages: []
      });
    }
  }

  workflow.status = deriveWorkflowStatus(workflow);
  const after = JSON.stringify(workflow.issues.map((issue) => ({
    issueId: issue.issueId,
    labels: issue.labels,
    prUrl: issue.prUrl,
    prLabels: issue.prLabels,
    prState: issue.prState
  })));
  if (before !== after) {
    workflow.timeline.push(`Synced GitHub issue/PR labels at ${new Date().toISOString()}.`);
  } else {
    workflow.timeline.push(`GitHub sync checked at ${new Date().toISOString()}; no label changes detected.`);
  }

  await saveWorkflow(workflow);
  return workflow;
}

async function runIssue(issue: IssueRecord, workflow: WorkflowRecord, codex: CodexClient, createIssue: (issue: IssueSpec) => Promise<{ number: number | null; htmlUrl: string | null; mock: boolean }>, project?: ProjectRecord | null): Promise<{
  timeline: string[];
  releaseNote: Record<string, string | boolean>;
  blocked: boolean;
}> {
  const issueOwnedPaths = issue.ownedPaths ?? [];
  const ownedPaths = issueOwnedPaths.length ? issueOwnedPaths.join(", ") : "unspecified";
  const timeline = [`Developer role ${issue.developerRole ?? issue.assigneeRole} started GitHub issue #${issue.githubIssueNumber ?? issue.issueId} with ownership: ${ownedPaths}.`];

  if (!project?.githubRepo || !issue.githubIssueNumber) {
    const followUp = await createIssue({
      title: `Blocked: ${issue.title}`,
      description: `Taskix could not start developer execution because this workflow issue has no bound GitHub repo or issue number.`,
      assigneeRole: "developer",
      developerRole: "general_developer",
      ownedPaths: [],
      acceptanceCriteria: ["Workflow issue has a GitHub issue number before developer execution starts"]
    });
    timeline.push(`Developer execution blocked; opened follow-up issue ${followUp.number ?? "local-only"}.`);
    return {
      timeline,
      releaseNote: {
        issueId: issue.issueId,
        issueTitle: issue.title,
        blocked: true,
        reason: "Missing GitHub repo or issue number"
      },
      blocked: true
    };
  }

  const developerStartedAt = new Date().toISOString();
  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: issue.developerSessionId ?? `${issue.issueId}:developer`,
      projectId: workflow.projectId,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      developerRole: issue.developerRole ?? "general_developer",
      ownedPaths: issueOwnedPaths,
      status: "active",
      currentStep: "developer handling GitHub issue",
      startedAt: developerStartedAt,
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      labels: ["taskix:dev-running"],
      messages: [
        { role: "system", content: `Owned paths: ${ownedPaths}`, createdAt: developerStartedAt },
        { role: "user", content: `Handle GitHub issue #${issue.githubIssueNumber}: ${issue.title}`, createdAt: developerStartedAt }
      ]
    });
  }

  const developerResult = await codex.developerHandleIssue({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber,
    issue,
    workflowId: displayWorkflowCode(workflow)
  });
  if (!developerResult.prUrl) {
    const recovery = await recoverDeveloperPullRequest(project.githubRepo, issue, workflow, developerResult.branch);
    if (recovery) {
      developerResult.prUrl = recovery.prUrl;
      developerResult.branch = recovery.branch;
      developerResult.summary = `${developerResult.summary}\n\nTaskix recovered existing PR context after developer publishing returned empty.\nRecovery source: ${recovery.source}.\nRecovered base: ${recovery.base ?? "repository default branch"}.`;
      timeline.push(`Recovered existing PR context for issue ${issue.issueId} via ${recovery.source}; base ${recovery.base ?? "repository default branch"}.`);
    }
  }
  issue.prUrl = developerResult.prUrl || null;
  issue.branch = developerResult.branch || null;
  if (workflow.projectId) {
    const finishedAt = new Date().toISOString();
    const closeAt = developerResult.prUrl ? finishedAt : null;
    await appendAgentMessages({
      sessionKey: issue.developerSessionId ?? `${issue.issueId}:developer`,
      projectId: workflow.projectId,
      role: "developer",
      title: `${issue.developerRole ?? "general_developer"}: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      developerRole: issue.developerRole ?? "general_developer",
      ownedPaths: issueOwnedPaths,
      status: developerResult.prUrl ? "done" : "blocked",
      currentStep: developerResult.prUrl ? "developer completed PR" : "developer blocked",
      startedAt: developerStartedAt,
      finishedAt,
      durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(developerStartedAt).getTime()),
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: developerResult.prUrl || null,
      labels: developerResult.prUrl ? ["taskix:pr-opened", "taskix:architect-review"] : ["taskix:blocked"],
      closedAt: closeAt,
      archivedAt: closeAt,
      messages: [
        { role: "assistant", content: `Summary: ${developerResult.summary}\nBranch: ${developerResult.branch || "none"}\nPR: ${developerResult.prUrl || "none"}\nTests: ${developerResult.testsRun.join(", ") || "none"}`, createdAt: new Date().toISOString() }
      ]
    });
  }
  timeline.push(developerResult.prUrl ? `Developer opened PR ${developerResult.prUrl} for issue ${issue.issueId}.` : `Developer did not return a PR for issue ${issue.issueId}.`);

  if (!developerResult.prUrl) {
    return {
      timeline,
      releaseNote: {
        issueId: issue.issueId,
        issueTitle: issue.title,
        developerRole: issue.developerRole ?? issue.assigneeRole,
        ownedPaths,
        developerSummary: developerResult.summary,
        blocked: true,
        reason: "Developer did not return PR URL"
      },
      blocked: true
    };
  }

  let architectReview = await requestInitialPrReview(project, issue, developerResult.prUrl, codex);
  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: `${workflow.projectId}:architect`,
      projectId: workflow.projectId,
      role: "architect",
      title: "Architect",
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      messages: [
        { role: "user", content: `Review PR for issue ${issue.issueId}: ${developerResult.prUrl}`, createdAt: new Date().toISOString() },
        { role: "assistant", content: `Decision: ${architectReview.decision}\n${architectReview.summary}\nLabels: ${architectReview.labelsApplied.join(", ") || "none"}`, createdAt: new Date().toISOString() }
      ]
    });
  }
  timeline.push(`Architect reviewed PR for issue ${issue.issueId}: ${architectReview.decision}.`);

  let qaPassed = false;
  let qaSummary = "QA not requested.";
  if (architectReview.decision === "need_qa") {
    const qaStartedAt = new Date().toISOString();
    if (workflow.projectId) {
      await appendAgentMessages({
        sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
        projectId: workflow.projectId,
        role: "qa",
        title: `QA: ${issue.title}`,
        workflowId: workflow.workflowId,
        issueId: issue.issueId,
        ownedPaths: issueOwnedPaths,
        status: "active",
        currentStep: "QA validating PR",
        startedAt: qaStartedAt,
        githubIssueNumber: issue.githubIssueNumber,
        githubIssueUrl: issue.githubIssueUrl ?? null,
        prUrl: developerResult.prUrl,
        labels: ["taskix:need-qa", "taskix:qa-running"],
        messages: [
          { role: "user", content: `Validate PR ${developerResult.prUrl} for issue #${issue.githubIssueNumber}: ${issue.title}`, createdAt: qaStartedAt }
        ]
      });
    }
    const qaResult = await codex.qaReviewPr({
      repo: project.githubRepo,
      issueNumber: issue.githubIssueNumber,
      prUrl: developerResult.prUrl
    });
    qaPassed = qaResult.passed;
    qaSummary = qaResult.summary;
    const qaFinishedAt = new Date().toISOString();
    const qaCloseAt = qaResult.passed ? qaFinishedAt : null;
  if (workflow.projectId) {
    await appendAgentMessages({
      sessionKey: issue.qaSessionId ?? `${issue.issueId}:qa`,
      projectId: workflow.projectId,
      role: "qa",
      title: `QA: ${issue.title}`,
      workflowId: workflow.workflowId,
      issueId: issue.issueId,
      ownedPaths: issueOwnedPaths,
      status: qaResult.passed ? "done" : "blocked",
      currentStep: qaResult.passed ? "QA passed" : "QA failed",
      startedAt: qaStartedAt,
      finishedAt: qaFinishedAt,
      durationMs: Math.max(0, new Date(qaFinishedAt).getTime() - new Date(qaStartedAt).getTime()),
      githubIssueNumber: issue.githubIssueNumber,
      githubIssueUrl: issue.githubIssueUrl ?? null,
      prUrl: developerResult.prUrl,
      labels: qaResult.labelsApplied,
      closedAt: qaCloseAt,
      archivedAt: qaCloseAt,
      messages: [
          { role: "assistant", content: `Passed: ${qaResult.passed}\n${qaResult.summary}\nFindings:\n${qaResult.findings.map((finding) => `- ${finding}`).join("\n") || "- none"}\nLabels: ${qaResult.labelsApplied.join(", ") || "none"}`, createdAt: new Date().toISOString() }
      ]
    });
  }
    if (qaResult.passed) {
      timeline.push(`QA passed PR for issue ${issue.issueId}.`);
      architectReview = await requestFinalPrReview(project, issue, developerResult.prUrl, codex);
      if (workflow.projectId) {
        await appendAgentMessages({
          sessionKey: `${workflow.projectId}:architect`,
          projectId: workflow.projectId,
          role: "architect",
          title: "Architect",
          workflowId: workflow.workflowId,
          issueId: issue.issueId,
          messages: [
            { role: "user", content: `QA passed PR ${developerResult.prUrl}. Perform final review/merge for issue ${issue.issueId}.`, createdAt: new Date().toISOString() },
            { role: "assistant", content: `Decision: ${architectReview.decision}\n${architectReview.summary}\nLabels: ${architectReview.labelsApplied.join(", ") || "none"}`, createdAt: new Date().toISOString() }
          ]
        });
      }
      timeline.push(`Architect final review after QA for issue ${issue.issueId}: ${architectReview.decision}.`);
    } else {
      timeline.push(`QA failed PR for issue ${issue.issueId}: ${qaResult.summary}`);
    }
  }

  const blocked = architectReview.decision === "blocked" || architectReview.decision === "changes_requested" || (architectReview.decision === "need_qa" && !qaPassed);

  return {
    timeline,
    releaseNote: {
      issueId: issue.issueId,
      issueTitle: issue.title,
      developerRole: issue.developerRole ?? issue.assigneeRole,
      ownedPaths,
      developerSummary: developerResult.summary,
      prUrl: developerResult.prUrl,
      qaPassed,
      qaSummary,
      architectDecision: architectReview.decision,
      architectSummary: architectReview.summary
    },
    blocked
  };
}

function createIssueCreator(project: ProjectRecord | null | undefined, settings: Awaited<ReturnType<typeof getSettings>>) {
  if (project?.githubRepo) {
    return (issue: IssueSpec) => createIssueWithGh(project.githubRepo, issue);
  }
  const github = new GitHubClient(settings.githubToken, settings.githubRepo, settings.githubApiUrl);
  return (issue: IssueSpec) => github.createIssue(issue);
}

function choosePrimaryPr(prs: Array<{ url: string; state: string; labels: string[] }>): { url: string; state: string; labels: string[] } | null {
  if (!prs.length) return null;
  return prs.find((pr) => pr.state === "OPEN") ?? prs[0];
}

function deriveQaSessionStatus(labels: string[]): "active" | "blocked" | "done" | null {
  if (labels.includes("taskix:qa-passed")) return "done";
  if (labels.includes("taskix:qa-failed")) return "blocked";
  if (labels.includes("taskix:need-qa") || labels.includes("taskix:qa-running")) return "active";
  return null;
}

async function recoverDeveloperPullRequest(
  repo: string,
  issue: IssueRecord,
  workflow: WorkflowRecord,
  branch: string
): Promise<{ prUrl: string; branch: string; base: string | null; source: string } | null> {
  try {
    const branchCandidates = prRecoveryBranches({
      developerBranch: branch,
      workflowCode: displayWorkflowCode(workflow),
      issueNumberOrId: issue.githubIssueNumber ?? issue.issueId
    });

    for (const candidateBranch of branchCandidates) {
      const existingPrUrl = await findPullRequestByHeadWithGh(repo, candidateBranch);
      if (!existingPrUrl) continue;
      const details = await readPullRequestRefs(repo, existingPrUrl);
      return {
        prUrl: existingPrUrl,
        branch: details.head ?? candidateBranch,
        base: details.base,
        source: branch && candidateBranch === branch ? "developer branch lookup" : "expected workflow branch lookup"
      };
    }

    if (!issue.githubIssueNumber) return null;
    const snapshot = await getIssueSnapshotWithGh(repo, issue.githubIssueNumber);
    const linkedPr = choosePrimaryPr(snapshot.linkedPrs);
    if (!linkedPr) return null;
    const details = await readPullRequestRefs(repo, linkedPr.url);
    return {
      prUrl: linkedPr.url,
      branch: details.head ?? expectedDeveloperBranch(displayWorkflowCode(workflow), issue.githubIssueNumber ?? issue.issueId),
      base: details.base,
      source: "linked issue pull request lookup"
    };
  } catch {
    return null;
  }
}

async function readPullRequestRefs(repo: string, pr: string): Promise<{ head: string | null; base: string | null; state: string | null; merged: boolean }> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", pr, "--repo", repo, "--json", "headRefName,baseRefName,state,mergedAt"]);
    const payload = JSON.parse(stdout) as { headRefName?: string; baseRefName?: string; state?: string; mergedAt?: string | null };
    return {
      head: payload.headRefName?.trim() || null,
      base: payload.baseRefName?.trim() || null,
      state: payload.state?.trim() || null,
      merged: Boolean(payload.mergedAt)
    };
  } catch {
    return { head: null, base: null, state: null, merged: false };
  }
}

async function requestInitialPrReview(project: ProjectRecord, issue: IssueRecord, prUrl: string, codex: CodexClient) {
  if (!project.autoDeploy && issue.githubIssueNumber) {
    const labels = ["taskix:need-qa"];
    await Promise.all([
      addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labels),
      addLabelsWithGh(project.githubRepo, prUrl, labels)
    ]);
    return {
      decision: "need_qa" as const,
      summary: `Manual-deploy project: Taskix requested QA for ${prUrl} and stopped before merge review.`,
      labelsApplied: labels,
      comments: []
    };
  }

  const review = await codex.architectReviewPr({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber ?? 0,
    prUrl,
    autoDeploy: project.autoDeploy
  });
  if (review.decision === "blocked" && !review.labelsApplied.length && review.summary.includes("Architect runner did not complete PR review") && issue.githubIssueNumber) {
    const labels = ["taskix:need-qa"];
    await Promise.all([
      addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labels),
      addLabelsWithGh(project.githubRepo, prUrl, labels)
    ]);
    return {
      decision: "need_qa" as const,
      summary: `Architect runner did not complete structured PR review. Taskix conservatively requested QA for ${prUrl}.`,
      labelsApplied: labels,
      comments: []
    };
  }
  return review;
}

async function requestFinalPrReview(project: ProjectRecord, issue: IssueRecord, prUrl: string, codex: CodexClient) {
  if (!project.autoDeploy && issue.githubIssueNumber) {
    const prRefs = await readPullRequestRefs(project.githubRepo, prUrl);
    const architectDecision = manualDeployArchitectPolicyDecision({
      prUrl,
      qaPassed: true,
      prState: prRefs.state,
      prMerged: prRefs.merged
    });
    const labelPlan = manualDeployFinalLabelPlan({ prUrl, architectDecision });
    if (labelPlan.decision !== "ready_to_merge") {
      await Promise.all([
        addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labelPlan.labelsApplied),
        addLabelsWithGh(project.githubRepo, prUrl, labelPlan.labelsApplied),
        removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labelPlan.labelsRemoved),
        removeLabelsWithGh(project.githubRepo, prUrl, labelPlan.labelsRemoved)
      ]);
      return {
        ...architectDecision,
        decision: labelPlan.decision,
        summary: labelPlan.summary,
        labelsApplied: labelPlan.labelsApplied,
        comments: labelPlan.comments
      };
    }

    await Promise.all([
      addLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labelPlan.labelsApplied),
      addLabelsWithGh(project.githubRepo, prUrl, labelPlan.labelsApplied),
      removeLabelsWithGh(project.githubRepo, issue.githubIssueNumber, labelPlan.labelsRemoved),
      removeLabelsWithGh(project.githubRepo, prUrl, labelPlan.labelsRemoved)
    ]);
    return {
      decision: "ready_to_merge" as const,
      summary: labelPlan.summary,
      labelsApplied: labelPlan.labelsApplied,
      comments: labelPlan.comments
    };
  }

  return codex.architectReviewPr({
    repo: project.githubRepo,
    issueNumber: issue.githubIssueNumber ?? 0,
    prUrl,
    autoDeploy: project.autoDeploy,
    qaPassed: true
  });
}

function deriveWorkflowStatus(workflow: WorkflowRecord): WorkflowRecord["status"] {
  if (!workflow.issues.length) return workflow.status;
  const issues = workflow.issues;
  const hasBlocked = issues.some((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:blocked", "taskix:qa-failed"]));
  if (hasBlocked) return "blocked";
  const allDone = issues.every((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:merged", "taskix:deployed"]) || issue.prState === "MERGED");
  if (allDone) return "done";
  const anyProgress = issues.some((issue) => includesAny([...(issue.labels ?? []), ...(issue.prLabels ?? [])], ["taskix:dev-running", "taskix:pr-opened", "taskix:architect-review", "taskix:need-qa", "taskix:qa-running", "taskix:qa-passed", "taskix:ready-to-merge"]));
  return anyProgress ? "in_progress" : workflow.status;
}

function includesAny(values: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => values.includes(candidate));
}

export function formatWorkflow(workflow: WorkflowRecord): string {
  const lines = [
    `Workflow ${displayWorkflowCode(workflow)}`,
    `Status: ${workflow.status}`,
    `Project: ${workflow.projectName ?? "default"}`,
    `Requirement: ${workflow.userRequirement}`,
    "",
    "Issues:"
  ];
  if (!workflow.issues.length) lines.push("- none");
  for (const issue of workflow.issues) {
    const role = issue.developerRole ?? issue.assigneeRole;
    const ownedPaths = issue.ownedPaths ?? [];
    const paths = ownedPaths.length ? ` paths: ${ownedPaths.join(", ")}` : "";
    lines.push(`- ${issue.issueId}: ${issue.title} [${role}]${paths} (${issue.githubIssueNumber ? `GitHub #${issue.githubIssueNumber}` : "local-only"})`);
  }
  lines.push("", "Timeline:", ...workflow.timeline.slice(-10).map((item) => `- ${item}`));
  return lines.join("\n");
}

function displayWorkflowCode(workflow: WorkflowRecord): string {
  return workflow.trackingCode ?? workflow.workflowId;
}
