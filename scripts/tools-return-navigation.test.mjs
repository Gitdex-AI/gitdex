import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveConsoleReturnDestination
} from "../src/lib/return-navigation.ts";
import {
  recentProjectChatsFromActivity
} from "../src/components/projects/recent-project-chats.ts";

test("tools return prefers known prior page state", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/tools",
    priorDestination: "/projects/project-a",
    recentProjectChats: [{ projectId: "project-b", latestAt: "2026-05-03T10:00:00.000Z" }]
  });

  assert.deepEqual(destination, {
    href: "/projects/project-a",
    source: "prior"
  });
});

test("tools return falls back to the most recent project chat", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/tools",
    recentProjectChats: [
      { projectId: "older", latestAt: "2026-05-01T10:00:00.000Z" },
      { projectId: "newer", latestAt: "2026-05-03T10:00:00.000Z" }
    ]
  });

  assert.deepEqual(destination, {
    href: "/projects/newer",
    source: "recent-project-chat"
  });
});

test("tools return fallback uses latest workflow activity instead of project creation", () => {
  const recentProjectChats = recentProjectChatsFromActivity(
    [
      project({ projectId: "newly-created", createdAt: "2026-05-04T10:00:00.000Z" }),
      project({ projectId: "recently-active", createdAt: "2026-05-01T10:00:00.000Z" })
    ],
    [
      workflow({
        workflowId: "wf-recent",
        projectId: "recently-active",
        createdAt: "2026-05-04T11:00:00.000Z"
      })
    ]
  );
  const destination = resolveConsoleReturnDestination({
    currentHref: "/tools",
    recentProjectChats
  });

  assert.deepEqual(destination, {
    href: "/projects/recently-active",
    source: "recent-project-chat"
  });
});

function project(overrides) {
  return {
    projectId: overrides.projectId,
    slug: overrides.projectId,
    name: overrides.projectId,
    repoUrl: `git@github.com:Gitdex-AI/${overrides.projectId}.git`,
    createdAt: overrides.createdAt
  };
}

function workflow(overrides) {
  return {
    workflowId: overrides.workflowId,
    projectId: overrides.projectId,
    requirement: "Test workflow",
    status: "draft",
    createdAt: overrides.createdAt
  };
}
