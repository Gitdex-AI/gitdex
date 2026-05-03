export type ProjectSwitcherProject = {
  projectId: string;
  name: string;
  slug: string;
  githubAccount: string;
  githubRepo: string;
};

export function projectIdFromPathname(pathname: string): string | null {
  const [pathOnly] = pathname.split(/[?#]/, 1);
  const segments = pathOnly.split("/").filter(Boolean);

  if (segments[0] !== "projects" || !segments[1] || segments[1] === "new") {
    return null;
  }

  return decodeURIComponent(segments[1]);
}

export function projectHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function currentProjectFromPathname(projects: ProjectSwitcherProject[], pathname: string): ProjectSwitcherProject | null {
  const projectId = projectIdFromPathname(pathname);
  if (!projectId) return null;

  return projects.find((project) => project.projectId === projectId) ?? null;
}

export function projectContextLabel(project: ProjectSwitcherProject): string {
  if (project.githubAccount && project.githubRepo) {
    return `${project.githubAccount}/${project.githubRepo}`;
  }

  return project.slug;
}
