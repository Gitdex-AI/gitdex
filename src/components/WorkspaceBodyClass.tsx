"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isProjectWorkspacePathname } from "@/components/project-switcher/routes";

export function WorkspaceBodyClass() {
  const pathname = usePathname();
  const workspaceMode = isProjectWorkspacePathname(pathname);

  useEffect(() => {
    document.body.classList.toggle("workspace-mode-body", workspaceMode);
    return () => {
      document.body.classList.remove("workspace-mode-body");
    };
  }, [workspaceMode]);

  return null;
}
