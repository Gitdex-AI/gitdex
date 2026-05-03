"use client";

const autoRunStartEvent = "gitdex:auto-run-start";

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
  void runningLabel;
  return children;
}
