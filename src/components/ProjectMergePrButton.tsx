"use client";

import { Alert, Anchor, Button, Group, Stack, Text } from "@mantine/core";
import { AlertTriangle, ExternalLink, GitPullRequestArrow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectMergePrButton({
  projectId,
  issueId,
  prUrl
}: {
  projectId: string;
  issueId: string;
  prUrl?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);

  async function mergePr() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/merge`, { method: "POST" });
      const payload = await response.json() as MergeResponse;
      if (!response.ok) {
        setResult({
          ok: false,
          message: payload.error ?? "Architect handoff failed",
          action: payload.action,
          architectUrl: payload.architectUrl,
          prUrl: payload.prUrl ?? prUrl,
          mergeable: payload.mergeable
        });
        return;
      }
      setResult({
        ok: true,
        message: "Architect started",
        architectUrl: payload.architectUrl,
        prUrl: payload.prUrl ?? prUrl
      });
      router.refresh();
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Architect handoff failed", prUrl });
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack gap={6} className="merge-pr-control">
      <Group gap={6} wrap="nowrap">
        <Button
          type="button"
          color="green"
          variant="filled"
          size="sm"
          radius="md"
          leftSection={<GitPullRequestArrow size={14} />}
          loading={pending}
          onClick={mergePr}
        >
          Ask architect
        </Button>
        {result?.ok ? <Text size="xs" c="green">{result.message}</Text> : null}
      </Group>
      {result?.ok && result.architectUrl ? (
        <Button component="a" href={result.architectUrl} size="compact-xs" variant="light" color="green" radius="xl">
          Open architect session
        </Button>
      ) : null}
      {result && !result.ok ? (
        <Alert className="merge-pr-error" color="red" variant="light" icon={<AlertTriangle size={16} />}>
          <Stack gap={4}>
            <Text size="xs" fw={760}>Architect handoff failed</Text>
            <Text size="xs">{result.message}</Text>
            {result.mergeable ? <Text size="xs" c="dimmed">GitHub mergeable state: {result.mergeable}</Text> : null}
            {result.action ? <Text size="xs" c="dimmed">{result.action}</Text> : null}
            <Group gap="xs">
              {result.architectUrl ? (
                <Button component="a" href={result.architectUrl} size="compact-xs" variant="light" color="red" radius="xl">
                  Open architect session
                </Button>
              ) : null}
              {result.prUrl ? (
                <Anchor size="xs" href={result.prUrl} target="_blank" rel="noreferrer">
                  <Group gap={4} component="span">
                    <ExternalLink size={12} />
                    Open pull request
                  </Group>
                </Anchor>
              ) : null}
            </Group>
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}

type MergeResponse = {
  error?: string;
  action?: string;
  architectUrl?: string;
  prUrl?: string | null;
  mergeable?: string | null;
};

type MergeResult = {
  ok: boolean;
  message: string;
  action?: string;
  architectUrl?: string;
  prUrl?: string | null;
  mergeable?: string | null;
};
