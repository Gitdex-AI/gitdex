"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Menu } from "@mantine/core";
import { FolderKanban, Gauge, Menu as MenuIcon, Settings, Wrench } from "lucide-react";

export function Nav({
  workflowCount,
  projectCount
}: {
  workflowCount: number;
  projectCount: number;
}) {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Dashboard", count: workflowCount, icon: Gauge, active: pathname === "/" },
    { href: "/projects", label: "Projects", count: projectCount, icon: FolderKanban, active: pathname.startsWith("/projects") },
    { href: "/tools", label: "Tools", icon: Wrench, active: pathname.startsWith("/tools") },
    { href: "/settings", label: "Settings", icon: Settings, active: pathname.startsWith("/settings") }
  ];

  return (
    <nav className="top-nav" aria-label="Primary">
      <div className="top-nav-links">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`top-nav-link ${item.active ? "active" : ""}`}>
              <span className="top-nav-link-main">
                <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>{item.label}</span>
              </span>
              {typeof item.count === "number" && (
                <Badge size="xs" variant={item.active ? "filled" : "light"} color={item.active ? "blue" : "gray"}>
                  {item.count}
                </Badge>
              )}
            </Link>
          );
        })}
      </div>
      <Menu shadow="md" width={220} position="bottom-end" withArrow>
        <Menu.Target>
          <button className="top-nav-menu-trigger" type="button" aria-label="Open primary navigation">
            <MenuIcon size={18} aria-hidden="true" />
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Menu.Item
                key={item.href}
                component={Link}
                href={item.href}
                leftSection={<Icon size={16} aria-hidden="true" />}
                rightSection={typeof item.count === "number" ? <Badge size="xs">{item.count}</Badge> : null}
              >
                {item.label}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
    </nav>
  );
}
