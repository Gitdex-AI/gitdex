import type { Metadata } from "next";
import { Badge, Code, Group, Text } from "@mantine/core";
import { getSettings } from "@/lib/settings";
import { listProjects, listWorkflows } from "@/lib/store";
import { Providers } from "@/components/Providers";
import { ShellLayout } from "@/components/ShellLayout";
import "@mantine/core/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taskix Console",
  description: "Project routing, Codex sessions, and GitHub issue orchestration"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, projects, workflows] = await Promise.all([getSettings(), listProjects(), listWorkflows()]);

  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="topbar">
            <Group gap="sm" wrap="nowrap">
              <div className="mark">TB</div>
              <div>
                <Text fw={800} size="md" c="white" lh={1.15}>
                  Taskix Hub
                </Text>
                <Text size="xs" c="blue.1">
                  Project routing, Codex sessions, GitHub orchestration
                </Text>
              </div>
            </Group>
            <Group gap="xs" justify="flex-end">
              <Badge color="dark" variant="light">
                Model <Code>{settings.codexModel}</Code>
              </Badge>
              <Badge color="dark" variant="light">
                Webhook <Code>{settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook</Code>
              </Badge>
            </Group>
          </header>
          <div className="shell">
            <ShellLayout workflowCount={workflows.length} projectCount={projects.length}>{children}</ShellLayout>
          </div>
        </Providers>
      </body>
    </html>
  );
}
