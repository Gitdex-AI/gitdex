"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  resolveConsoleReturnDestination,
  shouldRecordPriorConsoleDestination,
  type ConsoleReturnDestination,
  type RecentProjectChat
} from "@/lib/return-navigation";

const storageKey = "gitdex.console.priorDestination";

export function useConsoleReturnNavigation({
  recentProjectChats = [],
  fallbackHref
}: {
  recentProjectChats?: RecentProjectChat[];
  fallbackHref?: string;
} = {}): {
  currentHref: string;
  returnDestination: ConsoleReturnDestination;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentHref = useMemo(() => {
    const search = searchParams.toString();
    return search ? `${pathname}?${search}` : pathname;
  }, [pathname, searchParams]);
  const [priorDestination, setPriorDestination] = useState<string | null>(null);

  useEffect(() => {
    setPriorDestination(window.sessionStorage.getItem(storageKey));
  }, []);

  useEffect(() => {
    if (!shouldRecordPriorConsoleDestination(currentHref)) return;
    window.sessionStorage.setItem(storageKey, currentHref);
    setPriorDestination(currentHref);
  }, [currentHref]);

  return {
    currentHref,
    returnDestination: resolveConsoleReturnDestination({
      currentHref,
      priorDestination,
      recentProjectChats,
      fallbackHref
    })
  };
}
