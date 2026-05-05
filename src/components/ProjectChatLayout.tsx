"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "gitdex-sidebar-collapsed";

export function ProjectChatLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className={`project-chat-layout${collapsed ? " sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="project-sidebar-expand-button"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggleCollapsed}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <div className="project-sidebar-collapse-control">
        <button
          type="button"
          className="project-sidebar-collapse-button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={toggleCollapsed}
        >
          <PanelLeftClose size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}
