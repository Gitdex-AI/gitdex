import { NextResponse } from "next/server";
import { runJobsById } from "@/lib/job-runner";
import { getProject } from "@/lib/store";

type RunBatchRequest = {
  jobIds?: string[];
};

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const payload = await request.json().catch(() => ({})) as RunBatchRequest;
  const jobIds = [...new Set(payload.jobIds ?? [])].filter(Boolean);
  if (!jobIds.length) return NextResponse.json({ error: "No jobs selected." }, { status: 400 });

  const result = await runJobsById(jobIds, project.projectId);
  const notRunnable = result.results.filter((item) => !item.ran);
  if (notRunnable.length === result.results.length) {
    return NextResponse.json({ error: "No selected jobs were pending.", results: result.results }, { status: 409 });
  }
  return NextResponse.json(result);
}
