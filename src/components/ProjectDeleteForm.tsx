"use client";

import { Button, Group, TextInput } from "@mantine/core";
import { Trash2 } from "lucide-react";
import { useState } from "react";

export function ProjectDeleteForm({
  projectId,
  slug,
  compact = false
}: {
  projectId: string;
  slug: string;
  compact?: boolean;
}) {
  const [confirmation, setConfirmation] = useState("");
  const canDelete = confirmation === slug;

  return (
    <form method="post" action={`/api/projects/${projectId}`} className={compact ? "project-delete-form compact" : "project-delete-form"}>
      <input type="hidden" name="_action" value="delete" />
      <Group gap="xs" align="end" wrap="nowrap">
        <TextInput
          name="confirmation"
          aria-label={`Type ${slug} to delete project`}
          placeholder={slug}
          size="xs"
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
        />
        <Button
          type="submit"
          color="red"
          variant="light"
          size="xs"
          radius="xl"
          leftSection={<Trash2 size={14} />}
          disabled={!canDelete}
        >
          Delete
        </Button>
      </Group>
    </form>
  );
}
