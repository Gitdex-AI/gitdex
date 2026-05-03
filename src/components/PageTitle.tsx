import { Group, Text, Title } from "@mantine/core";

export function PageTitle({ title }: { title: string }) {
  return (
    <Group justify="space-between" align="flex-end" mb="md">
      <div>
        <Title order={1} size="h2">
          {title}
        </Title>
        <Text c="dimmed" size="sm">
          Gitdex control plane
        </Text>
      </div>
    </Group>
  );
}
