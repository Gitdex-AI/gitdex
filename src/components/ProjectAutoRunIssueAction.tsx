"use client";

import { Button } from "@mantine/core";
import { useEffect, useState } from "react";

const autoRunStartEvent = "taskix:auto-run-start";

export function announceIssueAutoRunStart() {
  window.dispatchEvent(new Event(autoRunStartEvent));
}

export function ProjectAutoRunIssueAction({
  runningLabel,
  children
}: {
  runningLabel: string;
  children: React.ReactNode;
}) {
  const [autoRunning, setAutoRunning] = useState(false);

  useEffect(() => {
    const handleAutoRun = () => setAutoRunning(true);
    window.addEventListener(autoRunStartEvent, handleAutoRun);
    return () => window.removeEventListener(autoRunStartEvent, handleAutoRun);
  }, []);

  if (autoRunning) {
    return (
      <Button type="button" variant="light" size="compact-xs" radius="xl" loading disabled>
        {runningLabel}
      </Button>
    );
  }

  return children;
}
