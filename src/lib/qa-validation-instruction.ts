export function qaValidationInstruction(
  prUrl: string,
  issue: { githubIssueNumber?: number | null; title: string },
  headSha?: string | null,
  previewUrl = "http://127.0.0.1:8001"
): string {
  const issueNumber = issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : "the source issue";
  return [
    `Validate PR ${prUrl} for issue ${issueNumber}: ${issue.title}`,
    ...(headSha ? [`Expected head SHA: ${headSha}`] : []),
    "",
    "Scope: local Gitdex program update validation only. Do not validate CI/CD, auto-merge, deployment, or user project workflow execution.",
    "",
    "Baseline commands:",
    "- npm test",
    "- npm run typecheck",
    "- npm run build",
    "",
    "Focused manual QA:",
    "- If the QA workspace is not already on the expected PR branch/head, recover it yourself inside the isolated QA clone with git/gh checkout or fetch commands before testing.",
    "- Do not modify the main Gitdex app checkout. It is acceptable to modify the isolated QA clone's git checkout state to validate the expected PR head.",
    `- Use an isolated DATA_DIR under /private/tmp and run the QA worktree on ${previewUrl}.`,
    `- If you start Next dev manually, bind to the assigned preview URL, for example: DATA_DIR=/private/tmp/gitdex-qa-${issue.githubIssueNumber ?? "issue"}-dev-data ./node_modules/.bin/next dev -H 127.0.0.1 -p ${new URL(previewUrl).port}.`,
    "- DATA_DIR isolation is a QA runner guard, not a product acceptance criterion unless this issue directly changes runtime data path handling. If the assigned preview port is available and browser validation can proceed safely, do not fail this PR solely because the PR branch does not include a later Gitdex DATA_DIR infrastructure fix.",
    "- Treat Next-generated next-env.d.ts route import changes as local tooling noise unless this issue explicitly concerns Next type generation. Restore it before final status when possible, or mention it as uncommitted generated noise.",
    "- Verify first-run setup, initialized login protection, protected internal APIs, version label, self-update failure handling, restart confirmation, restart polling, and page restoration end to end.",
    "- Record pages visited, controls clicked, observed results, and any environment limits."
  ].join("\n");
}
