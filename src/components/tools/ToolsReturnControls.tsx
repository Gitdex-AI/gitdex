"use client";

import { ConsoleReturnLink } from "@/components/console/ConsoleReturnLink";
import { useConsoleReturnNavigation } from "@/components/navigation/useConsoleReturnNavigation";
import type { RecentProjectChat } from "@/lib/return-navigation";

export function ToolsReturnControl({ recentProjectChats }: { recentProjectChats: RecentProjectChat[] }) {
  const { returnDestination } = useConsoleReturnNavigation({ recentProjectChats });

  return (
    <ConsoleReturnLink destination={returnDestination} data-return-source={returnDestination.source}>
      Back
    </ConsoleReturnLink>
  );
}
