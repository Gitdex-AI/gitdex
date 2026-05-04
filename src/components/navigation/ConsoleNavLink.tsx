"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { resolveConsoleNavAction, type ConsoleReturnDestination } from "@/lib/return-navigation";

export function ConsoleNavLink({
  currentHref,
  href,
  returnDestination,
  className,
  activeClassName = "active",
  children,
  ...props
}: {
  currentHref?: string | null;
  href: string;
  returnDestination: ConsoleReturnDestination;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "href" | "children" | "className">) {
  const action = resolveConsoleNavAction({ currentHref, itemHref: href, returnDestination });
  const resolvedClassName = action.active ? [className, activeClassName].filter(Boolean).join(" ") : className;

  return (
    <Link
      {...props}
      href={action.href}
      className={resolvedClassName}
      data-nav-action={action.action}
      aria-current={action.active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
