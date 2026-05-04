"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@mantine/core";
import { ArrowLeft } from "lucide-react";
import { useConsoleReturnNavigation } from "@/components/navigation/useConsoleReturnNavigation";
import type { RecentProjectChat } from "@/lib/return-navigation";
import { shouldAllowBrowserSettingsReturnNavigation } from "./settings-return-policy";

const settingsReturnSelector = "[data-settings-return-action]";

export function SettingsReturnNavigation({
  recentProjectChats = [],
  fallbackHref
}: {
  recentProjectChats?: RecentProjectChat[];
  fallbackHref?: string;
}) {
  const { returnDestination } = useConsoleReturnNavigation({ recentProjectChats, fallbackHref });
  const [dirty, setDirty] = useState(false);
  const formSnapshots = useRef(new WeakMap<HTMLFormElement, string>());

  const updateDirtyState = useCallback(() => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form[data-settings-form]"));
    const hasDirtyForm = forms.some((form) => serializeSettingsForm(form) !== getInitialSnapshot(form, formSnapshots.current));
    setDirty(hasDirtyForm);
  }, []);

  useEffect(() => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>("form[data-settings-form]"));
    formSnapshots.current = new WeakMap(forms.map((form) => [form, serializeSettingsForm(form)]));
    updateDirtyState();
  }, [updateDirtyState]);

  useEffect(() => {
    const handleFormChange = () => updateDirtyState();
    document.addEventListener("input", handleFormChange, true);
    document.addEventListener("change", handleFormChange, true);
    return () => {
      document.removeEventListener("input", handleFormChange, true);
      document.removeEventListener("change", handleFormChange, true);
    };
  }, [updateDirtyState]);

  useEffect(() => {
    const handleReturnClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(settingsReturnSelector) : null;
      if (!target) return;
      if (shouldAllowBrowserSettingsReturnNavigation({ isDirty: dirty })) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("click", handleReturnClick, true);
    return () => document.removeEventListener("click", handleReturnClick, true);
  }, [dirty]);

  return (
    <Button
      component={Link}
      href={returnDestination.href}
      variant="subtle"
      leftSection={<ArrowLeft size={16} />}
      data-settings-return-action
      data-return-source={returnDestination.source}
    >
      Return
    </Button>
  );
}

export function ProjectSettingsSidebarLink({
  projectId,
  active,
  recentProjectChats = [],
  children
}: {
  projectId: string;
  active: boolean;
  recentProjectChats?: RecentProjectChat[];
  children: ReactNode;
}) {
  const href = `/projects/${projectId}?panel=settings`;
  const { currentHref, returnDestination } = useConsoleReturnNavigation({ recentProjectChats });
  const resolvedHref = useMemo(() => {
    if (!active) return href;
    return returnDestination.href;
  }, [active, href, returnDestination.href]);

  return (
    <Link
      href={resolvedHref}
      className={`sidebar-icon-link${active ? " active" : ""}`}
      title="Settings"
      aria-label="Settings"
      aria-current={active ? "page" : undefined}
      data-nav-action={active ? "return" : "open"}
      data-settings-return-action={active ? true : undefined}
      data-return-source={active ? returnDestination.source : undefined}
      data-current-href={currentHref}
    >
      {children}
    </Link>
  );
}

function getInitialSnapshot(form: HTMLFormElement, snapshots: WeakMap<HTMLFormElement, string>): string {
  const snapshot = snapshots.get(form);
  if (snapshot !== undefined) return snapshot;
  const current = serializeSettingsForm(form);
  snapshots.set(form, current);
  return current;
}

function serializeSettingsForm(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()).map(([key, value]) => [key, String(value)]));
}
