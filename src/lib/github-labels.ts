import { developerRoleCatalog, type DeveloperRoleId } from "@/lib/developer-roles";

export const taskixLabels = [
  { name: "taskix:planned", color: "bfdadc", description: "Taskix issue planned by architect" },
  { name: "taskix:dev-running", color: "1d76db", description: "Taskix developer is working" },
  { name: "taskix:pr-opened", color: "5319e7", description: "Taskix developer opened a PR" },
  { name: "taskix:architect-review", color: "fbca04", description: "Taskix architect review required" },
  { name: "taskix:need-qa", color: "d93f0b", description: "Taskix QA validation required" },
  { name: "taskix:qa-running", color: "006b75", description: "Taskix QA is validating" },
  { name: "taskix:qa-passed", color: "0e8a16", description: "Taskix QA passed" },
  { name: "taskix:qa-failed", color: "b60205", description: "Taskix QA failed" },
  { name: "taskix:ready-to-merge", color: "0e8a16", description: "Taskix PR is ready to merge" },
  { name: "taskix:merged", color: "5319e7", description: "Taskix PR merged" },
  { name: "taskix:deployed", color: "0052cc", description: "Taskix deployment completed" },
  { name: "taskix:blocked", color: "b60205", description: "Taskix workflow blocked" },
  { name: "taskix:superseded", color: "6a737d", description: "Taskix PR was superseded by a newer active PR" }
] as const;

export const flowLabelNames = taskixLabels.map((label) => label.name);

export function roleLabel(role: DeveloperRoleId | null | undefined): string {
  return `role:${role ?? "general_developer"}`;
}

export function roleLabels(): Array<{ name: string; color: string; description: string }> {
  return developerRoleCatalog.map((role) => ({
    name: roleLabel(role.id),
    color: "c5def5",
    description: `Taskix developer role: ${role.label}`
  }));
}

export function allTaskixLabels(): Array<{ name: string; color: string; description: string }> {
  return [...taskixLabels, ...roleLabels()];
}
