import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isNonChatConsoleHref,
  isProjectChatHref,
  resolveConsoleNavAction,
  resolveConsoleReturnDestination,
  resolveProjectWorkspacePanelNavAction,
  shouldRecordPriorConsoleDestination
} from "../src/lib/return-navigation.ts";

test("return destination prefers known prior page state", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/settings",
    priorDestination: "/projects/project-a?workflow=wf-1",
    recentProjectChats: [{ projectId: "project-b", createdAt: "2026-05-01T10:00:00.000Z" }]
  });

  assert.deepEqual(destination, {
    href: "/projects/project-a?workflow=wf-1",
    source: "prior"
  });
});

test("return destination skips the current page and falls back to most recent project chat", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/settings",
    priorDestination: "/settings",
    recentProjectChats: [
      { projectId: "older", createdAt: "2026-05-01T10:00:00.000Z" },
      { projectId: "newer", createdAt: "2026-05-03T10:00:00.000Z" }
    ]
  });

  assert.deepEqual(destination, {
    href: "/projects/newer",
    source: "recent-project-chat"
  });
});

test("return destination uses stable fallback when no prior page or project chat is known", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/tools",
    recentProjectChats: []
  });

  assert.deepEqual(destination, {
    href: "/projects",
    source: "fallback"
  });
});

test("non-chat views do not replace the prior chat return target", () => {
  assert.equal(shouldRecordPriorConsoleDestination("/projects/project-a"), true);
  assert.equal(shouldRecordPriorConsoleDestination("/projects/project-a?workflow=wf-1"), true);
  assert.equal(shouldRecordPriorConsoleDestination("/settings"), false);
  assert.equal(shouldRecordPriorConsoleDestination("/projects/project-a?panel=tools"), false);
  assert.equal(shouldRecordPriorConsoleDestination("/api/projects"), false);
});

test("project chat and non-chat paths are classified independently", () => {
  assert.equal(isProjectChatHref("/projects/project-a"), true);
  assert.equal(isProjectChatHref("/projects/project-a?panel=settings"), false);
  assert.equal(isNonChatConsoleHref("/projects/project-a?panel=settings"), true);
  assert.equal(isNonChatConsoleHref("/tools"), true);
});

test("active left-bottom navigation re-click resolves to shared return action", () => {
  const action = resolveConsoleNavAction({
    currentHref: "/projects/project-a?panel=tools",
    itemHref: "/projects/project-a?panel=tools",
    returnDestination: { href: "/projects/project-a", source: "prior" }
  });

  assert.deepEqual(action, {
    href: "/projects/project-a",
    active: true,
    action: "return"
  });
});

test("inactive left-bottom navigation opens the selected destination", () => {
  const action = resolveConsoleNavAction({
    currentHref: "/projects/project-a?panel=settings",
    itemHref: "/projects/project-a?panel=tools",
    returnDestination: { href: "/projects/project-a", source: "prior" }
  });

  assert.deepEqual(action, {
    href: "/projects/project-a?panel=tools",
    active: false,
    action: "open"
  });
});

test("active project workspace panel nav re-click returns to the same project workspace", () => {
  const action = resolveProjectWorkspacePanelNavAction({
    projectId: "project-a",
    panel: "tools",
    activePanel: "tools"
  });

  assert.deepEqual(action, {
    href: "/projects/project-a",
    active: true,
    action: "return"
  });
});

test("active project workspace panel nav preserves encoded project id", () => {
  const action = resolveProjectWorkspacePanelNavAction({
    projectId: "project/a",
    panel: "settings",
    activePanel: "settings"
  });

  assert.deepEqual(action, {
    href: "/projects/project%2Fa",
    active: true,
    action: "return"
  });
});

test("inactive project workspace panel nav opens the requested panel for the same project", () => {
  const action = resolveProjectWorkspacePanelNavAction({
    projectId: "project-a",
    panel: "settings",
    activePanel: "tools"
  });

  assert.deepEqual(action, {
    href: "/projects/project-a?panel=settings",
    active: false,
    action: "open"
  });
});
