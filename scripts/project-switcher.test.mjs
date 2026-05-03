import assert from "node:assert/strict";
import {
  currentProjectFromPathname,
  projectContextLabel,
  projectHref,
  projectIdFromPathname
} from "../src/components/project-switcher/routes.ts";

const projects = [
  {
    projectId: "alpha-1",
    name: "Dispatch",
    slug: "dispatch",
    githubAccount: "Taskix-AI",
    githubRepo: "Dispatch"
  },
  {
    projectId: "beta-2",
    name: "Dispatch",
    slug: "dispatch-beta",
    githubAccount: "Taskix-AI",
    githubRepo: "DispatchBeta"
  }
];

assert.equal(projectIdFromPathname("/projects/alpha-1"), "alpha-1", "Project detail routes should expose the project id");
assert.equal(projectIdFromPathname("/projects/alpha-1/requirements"), "alpha-1", "Nested project routes should expose the project id");
assert.equal(projectIdFromPathname("/projects"), null, "The project index should not expose a current project id");
assert.equal(projectIdFromPathname("/projects/new"), null, "The new-project route should not expose a current project id");
assert.equal(projectIdFromPathname("/workflows"), null, "Non-project routes should not expose a current project id");

assert.equal(currentProjectFromPathname(projects, "/projects/alpha-1/requirements")?.name, "Dispatch", "Known project routes should resolve the current project");
assert.equal(currentProjectFromPathname(projects, "/projects/missing"), null, "Unknown project ids should not render a current project");
assert.equal(projectHref("beta-2"), "/projects/beta-2", "Switch targets should use existing project detail routes");
assert.equal(projectContextLabel(projects[1]), "Taskix-AI/DispatchBeta", "Project entries should include repository context for similar names");

console.log("project switcher verification passed");
