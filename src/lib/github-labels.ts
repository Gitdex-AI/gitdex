import { developerRoleCatalog, type DeveloperRoleId } from "@/lib/developer-roles";

export const gitdexLabels = [
  { name: "gd:dev", color: "1d76db", description: "Gitdex issue stage: developer implementation" },
  { name: "gd:fix", color: "d93f0b", description: "Gitdex issue stage: developer fix required" },
  { name: "gd:rebase", color: "d93f0b", description: "Gitdex issue stage: developer rebase required" },
  { name: "gd:qa", color: "006b75", description: "Gitdex issue stage: QA validation" },
  { name: "gd:review", color: "fbca04", description: "Gitdex issue stage: code review" },
  { name: "gd:merge", color: "0e8a16", description: "Gitdex issue stage: merge" },
  { name: "gd:architect", color: "b60205", description: "Gitdex issue stage: architect clarification" },
  { name: "gd:blocked", color: "5319e7", description: "Gitdex issue stage: blocked by environment or external condition" },
  { name: "gd:done", color: "5319e7", description: "Gitdex issue stage: done" },
  { name: "gitdex:dev-running", color: "1d76db", description: "Gitdex developer is working" },
  { name: "gitdex:architect-review", color: "fbca04", description: "Gitdex architect review required" },
  { name: "gitdex:need-qa", color: "d93f0b", description: "Gitdex QA validation required" },
  { name: "gitdex:qa-running", color: "006b75", description: "Gitdex QA is validating" },
  { name: "gitdex:qa-passed", color: "0e8a16", description: "Gitdex QA passed" },
  { name: "gitdex:qa-failed", color: "b60205", description: "Gitdex QA failed" },
  { name: "gitdex:env-blocked", color: "5319e7", description: "Gitdex workflow blocked by local validation environment" },
  { name: "gitdex:spec-blocked", color: "b60205", description: "Gitdex issue needs architect clarification" },
  { name: "gitdex:ready-to-merge", color: "0e8a16", description: "Gitdex PR is ready to merge" },
  { name: "gitdex:needs-rebase", color: "d93f0b", description: "Gitdex PR must return to developer for rebase or branch update" },
  { name: "gitdex:merged", color: "5319e7", description: "Gitdex PR merged" },
  { name: "gitdex:deployed", color: "0052cc", description: "Gitdex deployment completed" },
  { name: "gitdex:blocked", color: "b60205", description: "Gitdex workflow blocked" },
  { name: "gitdex:superseded", color: "6a737d", description: "Gitdex PR was superseded by a newer active PR" }
] as const;

export const flowLabelNames = gitdexLabels.map((label) => label.name);

export function roleLabel(role: DeveloperRoleId | null | undefined): string {
  return `role:${role ?? "general_developer"}`;
}

export function roleLabels(): Array<{ name: string; color: string; description: string }> {
  return developerRoleCatalog.map((role) => ({
    name: roleLabel(role.id),
    color: "c5def5",
    description: `Gitdex developer role: ${role.label}`
  }));
}

export function allGitdexLabels(): Array<{ name: string; color: string; description: string }> {
  return [...gitdexLabels, ...roleLabels()];
}
