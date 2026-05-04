"use client";

import { Group } from "@mantine/core";
import { FolderKanban } from "lucide-react";
import type { ReactNode } from "react";
import { ConsoleReturnLink } from "@/components/console/ConsoleReturnLink";
import { ConsoleNavLink } from "@/components/navigation/ConsoleNavLink";
import { useConsoleReturnNavigation } from "@/components/navigation/useConsoleReturnNavigation";
import type { RecentProjectChat } from "@/lib/return-navigation";

export function ProjectListReturnControl({ recentProjectChats }: { recentProjectChats: RecentProjectChat[] }) {
  const { returnDestination } = useConsoleReturnNavigation({ recentProjectChats });

  return (
    <ConsoleReturnLink destination={returnDestination}>
      Back
    </ConsoleReturnLink>
  );
}

export function ProjectListSidebarLink({
  active,
  projectId,
  recentProjectChats
}: {
  active: boolean;
  projectId: string;
  recentProjectChats: RecentProjectChat[];
}) {
  const { currentHref, returnDestination } = useConsoleReturnNavigation({ recentProjectChats });
  const projectListHref = `/projects/${projectId}?panel=projects`;

  return (
    <ConsoleNavLink
      href={projectListHref}
      currentHref={active ? projectListHref : currentHref}
      returnDestination={returnDestination}
      className="sidebar-icon-link"
      title="Projects"
      aria-label="Projects"
    >
      <FolderKanban size={16} />
    </ConsoleNavLink>
  );
}

export function ProjectListHeaderActions({
  recentProjectChats,
  children
}: {
  recentProjectChats: RecentProjectChat[];
  children: ReactNode;
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <ProjectListReturnControl recentProjectChats={recentProjectChats} />
      {children}
    </Group>
  );
}
