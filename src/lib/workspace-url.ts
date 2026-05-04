export function projectWorkspaceHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function workflowWorkspaceHref(input: {
  projectId: string;
  workflowId?: string | null;
  jobId?: string | null;
  autorun?: boolean;
  phase?: string;
}): string {
  const params = new URLSearchParams();
  if (input.workflowId) {
    params.set("workflow", input.workflowId);
    params.set("phase", input.phase ?? "github");
  }
  if (input.jobId) params.set("job", input.jobId);
  if (input.autorun) params.set("autorun", "1");
  const search = params.toString();
  return search ? `${projectWorkspaceHref(input.projectId)}?${search}` : projectWorkspaceHref(input.projectId);
}
