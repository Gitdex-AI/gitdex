export type ConsoleDestination = {
  href: string;
  label?: string;
};

export type RecentProjectChat = {
  projectId: string;
  latestAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

export type ConsoleReturnDestination = {
  href: string;
  source: "prior" | "recent-project-chat" | "fallback";
};

export type ConsoleNavAction = {
  href: string;
  active: boolean;
  action: "open" | "return";
};

export type ProjectWorkspacePanel = "tools" | "settings" | "requirements" | "triage";

export const defaultConsoleReturnHref = "/";

const nonChatConsolePaths = new Set(["/projects/new"]);

export function resolveConsoleReturnDestination(input: {
  currentHref?: string | null;
  priorDestination?: ConsoleDestination | string | null;
  recentProjectChats?: RecentProjectChat[];
  fallbackHref?: string;
}): ConsoleReturnDestination {
  const currentHref = normalizeConsoleHref(input.currentHref);
  const priorHref = normalizeConsoleHref(typeof input.priorDestination === "string" ? input.priorDestination : input.priorDestination?.href);

  if (priorHref && priorHref !== currentHref) {
    return { href: priorHref, source: "prior" };
  }

  const recentChatHref = mostRecentProjectChatHref(input.recentProjectChats ?? []);
  if (recentChatHref && recentChatHref !== currentHref) {
    return { href: recentChatHref, source: "recent-project-chat" };
  }

  return { href: normalizeConsoleHref(input.fallbackHref) ?? defaultConsoleReturnHref, source: "fallback" };
}

export function resolveConsoleNavAction(input: {
  currentHref?: string | null;
  itemHref: string;
  returnDestination: ConsoleReturnDestination;
}): ConsoleNavAction {
  const currentHref = normalizeConsoleHref(input.currentHref);
  const itemHref = normalizeConsoleHref(input.itemHref) ?? input.itemHref;
  const active = currentHref === itemHref;

  return {
    href: active ? input.returnDestination.href : itemHref,
    active,
    action: active ? "return" : "open"
  };
}

export function resolveProjectWorkspacePanelNavAction(input: {
  projectId: string;
  panel: ProjectWorkspacePanel;
  activePanel?: ProjectWorkspacePanel | null;
}): ConsoleNavAction {
  const workspaceHref = `/projects/${encodeURIComponent(input.projectId)}`;
  const panelHref = `${workspaceHref}?panel=${input.panel}`;
  const active = input.activePanel === input.panel;

  return {
    href: active ? workspaceHref : panelHref,
    active,
    action: active ? "return" : "open"
  };
}

export function shouldRecordPriorConsoleDestination(href: string | null | undefined): boolean {
  const normalized = normalizeConsoleHref(href);
  return Boolean(normalized && !isNonChatConsoleHref(normalized));
}

export function isProjectChatHref(href: string | null | undefined): boolean {
  const normalized = normalizeConsoleHref(href);
  if (!normalized) return false;

  const { pathname, searchParams } = splitConsoleHref(normalized);
  if (searchParams.has("panel")) return false;

  const segments = pathname.split("/").filter(Boolean);
  return segments.length === 2 && segments[0] === "projects" && segments[1] !== "new";
}

export function isNonChatConsoleHref(href: string | null | undefined): boolean {
  const normalized = normalizeConsoleHref(href);
  if (!normalized) return false;

  const { pathname, searchParams } = splitConsoleHref(normalized);
  if (searchParams.has("panel")) return true;
  return nonChatConsolePaths.has(pathname);
}

export function normalizeConsoleHref(href: string | null | undefined): string | null {
  if (!href) return null;

  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  try {
    const url = new URL(trimmed, "http://gitdex.local");
    if (url.origin !== "http://gitdex.local" && !trimmed.startsWith("/")) return null;
    if (!url.pathname.startsWith("/")) return null;
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function mostRecentProjectChatHref(projects: RecentProjectChat[]): string | null {
  const mostRecent = projects
    .filter((project) => project.projectId)
    .slice()
    .sort((left, right) => timestampForProject(right) - timestampForProject(left))[0];

  return mostRecent ? `/projects/${encodeURIComponent(mostRecent.projectId)}` : null;
}

function timestampForProject(project: RecentProjectChat): number {
  const value = project.latestAt ?? project.updatedAt ?? project.createdAt;
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function splitConsoleHref(href: string): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(href, "http://gitdex.local");
  return { pathname: url.pathname, searchParams: url.searchParams };
}
