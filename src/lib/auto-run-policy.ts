import type { IssueRecord } from "./types.ts";
// @ts-expect-error Node strip-types tests require the explicit source extension.
import { getIssueStage } from "./issue-stage.ts";

export function canAutoRunDeveloper(issue: IssueRecord): boolean {
  return !isClosedIssue(issue)
    && !issue.prUrl
    && issue.prState !== "MERGED"
    && getIssueStage(issue) === "gd:dev";
}

export function canAutoRunQa(issue: IssueRecord): boolean {
  return Boolean(issue.prUrl)
    && !isClosedIssue(issue)
    && issue.prState !== "MERGED"
    && getIssueStage(issue) === "gd:qa";
}

export function isClosedIssue(issue: IssueRecord): boolean {
  return issue.githubState === "CLOSED" || issue.prState === "CLOSED" || issue.prState === "MERGED";
}
