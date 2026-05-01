"use client";

import { Button } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function ProjectGitHubTriageRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="light"
      size="xs"
      radius="xl"
      leftSection={<RefreshCw size={14} />}
      loading={pending}
      onClick={refresh}
    >
      Refresh
    </Button>
  );
}
