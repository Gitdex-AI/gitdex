import type { DatabaseSync } from "node:sqlite";
import type { ProjectRecord, WorkflowRecord } from "@/lib/types";

export function deleteProjectLocalState(database: DatabaseSync, project: ProjectRecord): void {
  const workflowIds = listProjectWorkflowIds(database, project.projectId);
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM projects WHERE project_id = ?").run(project.projectId);
    database.prepare("DELETE FROM chat_projects WHERE project_id = ?").run(project.projectId);
    database.prepare("DELETE FROM jobs WHERE project_id = ?").run(project.projectId);
    database.prepare("DELETE FROM agent_sessions WHERE project_id = ?").run(project.projectId);
    for (const workflowId of workflowIds) {
      database.prepare("DELETE FROM workflows WHERE workflow_id = ?").run(workflowId);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function listProjectWorkflowIds(database: DatabaseSync, projectId: string): string[] {
  const rows = database.prepare("SELECT workflow_id, payload FROM workflows").all() as { workflow_id: string; payload: string }[];
  return rows
    .filter((row) => {
      const workflow = JSON.parse(row.payload) as WorkflowRecord;
      return workflow.projectId === projectId;
    })
    .map((row) => row.workflow_id);
}
