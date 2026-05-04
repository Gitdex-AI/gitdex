import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";

export default async function WorkflowDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string; workflowId: string }>;
  searchParams: Promise<{ autorun?: string; job?: string }>;
}) {
  const [{ projectId, workflowId }, query] = await Promise.all([params, searchParams]);
  const currentPath = query.autorun ? `/projects/${projectId}/workflows/${workflowId}?autorun=${encodeURIComponent(query.autorun)}` : `/projects/${projectId}/workflows/${workflowId}`;
  await requireConsolePageAuth(currentPath);

  const target = new URLSearchParams({
    workflow: workflowId,
    phase: "github"
  });
  if (query.autorun) target.set("autorun", query.autorun);
  if (query.job) target.set("job", query.job);

  redirect(`/projects/${encodeURIComponent(projectId)}?${target.toString()}`);
}
