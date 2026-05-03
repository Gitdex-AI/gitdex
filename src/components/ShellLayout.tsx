"use client";

import { usePathname } from "next/navigation";
import { isProjectWorkspacePathname } from "@/components/project-switcher/routes";

export function ShellLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const workspaceMode = isProjectWorkspacePathname(pathname);

  return (
    <div className={`shell${workspaceMode ? " workspace-shell" : ""}`}>
      <div className={`layout${workspaceMode ? " workspace-mode" : ""}`}>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
