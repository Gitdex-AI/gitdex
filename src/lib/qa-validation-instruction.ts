export function qaValidationInstruction(
  prUrl: string,
  issue: { githubIssueNumber?: number | null; title: string },
  headSha?: string | null
): string {
  const issueNumber = issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : "the source issue";
  return [
    `Validate PR ${prUrl} for issue ${issueNumber}: ${issue.title}`,
    ...(headSha ? [`Expected head SHA: ${headSha}`] : []),
    "",
    "Scope: local Taskix program update validation only. Do not validate CI/CD, auto-merge, deployment, or user project workflow execution.",
    "",
    "Baseline commands:",
    "- npm test",
    "- npm run typecheck",
    "- npm run build",
    "",
    "Focused manual QA:",
    "- Use an isolated DATA_DIR under /private/tmp and run the QA worktree on http://127.0.0.1:8001.",
    "- Verify first-run setup, initialized login protection, protected internal APIs, version label, self-update failure handling, restart confirmation, restart polling, and page restoration end to end.",
    "- Record pages visited, controls clicked, observed results, and any environment limits."
  ].join("\n");
}
