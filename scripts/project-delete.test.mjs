import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

process.chdir(mkdtempSync(`${tmpdir()}/taskix-project-delete-`));

const { deleteProjectLocalState } = await import("../src/lib/project-delete.ts");

describe("deleteProjectLocalState", () => {
  it("removes a project and its local Taskix state", async () => {
    const database = createTestDatabase();
    const project = {
      projectId: "project-delete-test",
      slug: "delete-me",
      name: "Delete Me",
      githubRepo: "Taskix-AI/Taskix"
    };
    database.prepare("INSERT INTO projects (project_id, slug, created_at, payload) VALUES (?, ?, ?, ?)").run(project.projectId, project.slug, new Date().toISOString(), JSON.stringify(project));
    database.prepare("INSERT INTO chat_projects (chat_id, project_id) VALUES (?, ?)").run(12345, project.projectId);
    database.prepare("INSERT INTO workflows (workflow_id, created_at, payload) VALUES (?, ?, ?)").run("wf-delete-test", new Date().toISOString(), JSON.stringify({
      workflowId: "wf-delete-test",
      trackingCode: "WF-DELETE",
      userRequirement: "delete test",
      status: "created",
      chatId: 12345,
      createdAt: new Date().toISOString(),
      projectId: project.projectId,
      projectName: project.name,
      issues: [],
      timeline: []
    }));
    database.prepare("INSERT INTO jobs (job_id, project_id, type, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)").run("job-delete-test", project.projectId, "workflow_run", "pending", new Date().toISOString(), new Date().toISOString(), JSON.stringify({
      jobId: "job-delete-test",
      projectId: project.projectId,
      type: "workflow_run",
      status: "pending",
      payload: { workflowId: "wf-delete-test" }
    }));
    database.prepare("INSERT INTO agent_sessions (session_key, project_id, role, updated_at, payload) VALUES (?, ?, ?, ?, ?)").run(`${project.projectId}:product_manager`, project.projectId, "product_manager", new Date().toISOString(), JSON.stringify({
      sessionKey: `${project.projectId}:product_manager`,
      projectId: project.projectId,
      role: "product_manager",
      title: "Project Manager",
      status: "active",
      messages: [{ role: "user", content: "hello", createdAt: new Date().toISOString() }]
    }));

    deleteProjectLocalState(database, project);

    assert.equal(count(database, "projects", "project_id", project.projectId), 0);
    assert.equal(count(database, "chat_projects", "project_id", project.projectId), 0);
    assert.equal(count(database, "workflows", "workflow_id", "wf-delete-test"), 0);
    assert.equal(count(database, "jobs", "project_id", project.projectId), 0);
    assert.equal(count(database, "agent_sessions", "project_id", project.projectId), 0);
  });
});

function createTestDatabase() {
  mkdirSync("data", { recursive: true });
  const database = new DatabaseSync(join("data", "delete-test.sqlite"));
  database.exec(`
    CREATE TABLE projects (project_id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE workflows (workflow_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE chat_projects (chat_id INTEGER PRIMARY KEY, project_id TEXT NOT NULL);
    CREATE TABLE agent_sessions (session_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, role TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE jobs (job_id TEXT PRIMARY KEY, project_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  return database;
}

function count(database, table, column, value) {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value);
  return row.count;
}
