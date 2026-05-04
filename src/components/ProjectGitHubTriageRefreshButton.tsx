"use client";

import { Button } from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectGitHubTriageRefreshButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function refresh() {
    setPending(true);
    void fetch(`/api/projects/${projectId}/sync`, { method: "POST" })
      .finally(() => {
        setPending(false);
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
      disabled={pending}
      onClick={refresh}
    >
      Sync
    </Button>
  );
}
