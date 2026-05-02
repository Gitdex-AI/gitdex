"use client";

import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectArchitectReviewButton({
  projectId,
  issueId
}: {
  projectId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  async function reviewPr() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${issueId}/architect-review`, { method: "POST" });
      const payload = await response.json() as ReviewResponse;
      if (!response.ok) {
        setResult({ ok: false, message: payload.error ?? "Architect review failed", action: payload.action });
        return;
      }
      setResult({ ok: true, message: payload.message ?? "Architect reviewed" });
      router.refresh();
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Architect review failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap">
        <Button
          type="button"
          color="blue"
          variant="light"
          size="sm"
          radius="md"
          leftSection={<ShieldCheck size={14} />}
          loading={pending}
          onClick={reviewPr}
        >
          Run Review
        </Button>
        {result?.ok ? <Text size="xs" c="green">{result.message}</Text> : null}
      </Group>
      {result && !result.ok ? (
        <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
          <Stack gap={4}>
            <Text size="xs" fw={760}>Architect review failed</Text>
            <Text size="xs">{result.message}</Text>
            {result.action ? <Text size="xs" c="dimmed">{result.action}</Text> : null}
          </Stack>
        </Alert>
      ) : null}
    </Stack>
  );
}

type ReviewResponse = {
  error?: string;
  action?: string;
  message?: string;
};

type ReviewResult = {
  ok: boolean;
  message: string;
  action?: string;
};
