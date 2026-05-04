import { redirect } from "next/navigation";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listProjects } from "@/lib/store";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildSettingsNextPath({ message, error }));
  const latestProject = await latestProjectId();
  if (!latestProject) redirect(`/projects/new${buildQuery({ error: error ?? message })}`);
  redirect(`/projects/${latestProject}?panel=settings${buildQuery({ message, error }, "&")}`);
}

function buildSettingsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}

async function latestProjectId(): Promise<string | null> {
  const projects = await listProjects();
  return projects
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]?.projectId ?? null;
}

function buildQuery({ message, error }: { message?: string; error?: string }, prefix = "?"): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `${prefix}${query}` : "";
}
