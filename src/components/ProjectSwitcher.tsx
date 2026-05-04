"use client";

import { Menu, Text } from "@mantine/core";
import { Check, ChevronsUpDown, FolderKanban, FolderPlus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  currentProjectFromPathname,
  projectContextLabel,
  projectHref,
  type ProjectSwitcherProject
} from "@/components/project-switcher/routes";

export function ProjectSwitcher({ projects, variant = "sidebar" }: { projects: ProjectSwitcherProject[]; variant?: "sidebar" }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentProject = currentProjectFromPathname(projects, pathname);

  if (!currentProject) {
    return null;
  }

  return (
    <Menu shadow="md" width={280} position="bottom-end" withArrow>
      <Menu.Target>
        <button className={`project-switcher-trigger ${variant}`} type="button" aria-label={`Current project: ${currentProject.name}`}>
          <FolderKanban size={16} aria-hidden="true" />
          <span className="project-switcher-trigger-label">{currentProject.name}</span>
          <ChevronsUpDown size={14} aria-hidden="true" />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Project</Menu.Label>
        {projects.map((project) => {
          const isCurrent = project.projectId === currentProject.projectId;

          return (
            <Menu.Item
              key={project.projectId}
              leftSection={isCurrent ? <Check size={16} aria-hidden="true" /> : <FolderKanban size={16} aria-hidden="true" />}
              disabled={isCurrent}
              onClick={() => {
                router.push(projectHref(project.projectId));
              }}
            >
              <span className="project-switcher-item">
                <Text component="span" size="sm" fw={700}>
                  {project.name}
                </Text>
                <Text component="span" size="xs" c="dimmed">
                  {projectContextLabel(project)}
                </Text>
              </span>
            </Menu.Item>
          );
        })}
        <Menu.Divider />
        <Menu.Item
          leftSection={<FolderPlus size={16} aria-hidden="true" />}
          onClick={() => {
            router.push("/projects/new");
          }}
        >
          <Text component="span" size="sm" fw={700}>
            Add Project
          </Text>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
