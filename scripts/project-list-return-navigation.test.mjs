import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveConsoleNavAction,
  resolveConsoleReturnDestination
} from "../src/lib/return-navigation.ts";

test("project list return prefers known prior page state", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/projects",
    priorDestination: "/projects/project-a",
    recentProjectChats: [{ projectId: "project-b", latestAt: "2026-05-03T10:00:00.000Z" }]
  });

  assert.deepEqual(destination, {
    href: "/projects/project-a",
    source: "prior"
  });
});

test("project list return falls back to the most recent project chat", () => {
  const destination = resolveConsoleReturnDestination({
    currentHref: "/projects",
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

test("active project-list sidebar navigation re-click returns to the prior page", () => {
  const action = resolveConsoleNavAction({
    currentHref: "/projects/project-a?panel=projects",
    itemHref: "/projects/project-a?panel=projects",
    returnDestination: { href: "/projects/project-a", source: "prior" }
  });

  assert.deepEqual(action, {
    href: "/projects/project-a",
    active: true,
    action: "return"
  });
});

test("active project-list sidebar navigation falls back to current project chat", () => {
  const returnDestination = resolveConsoleReturnDestination({
    currentHref: "/projects/project-a?panel=projects",
    recentProjectChats: [{ projectId: "project-a", latestAt: "2026-05-03T10:00:00.000Z" }]
  });
  const action = resolveConsoleNavAction({
    currentHref: "/projects/project-a?panel=projects",
    itemHref: "/projects/project-a?panel=projects",
    returnDestination
  });

  assert.deepEqual(action, {
    href: "/projects/project-a",
    active: true,
    action: "return"
  });
});
