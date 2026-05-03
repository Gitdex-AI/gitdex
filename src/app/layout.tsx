import type { Metadata } from "next";
import { Badge, Code, Group, Text } from "@mantine/core";
import { getSettings } from "@/lib/settings";
import { listProjects, listWorkflows } from "@/lib/store";
import { Providers } from "@/components/Providers";
import { SelfUpdateDialog } from "@/components/SelfUpdateDialog";
import { ShellLayout } from "@/components/ShellLayout";
import packageJson from "../../package.json";
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
            <Group className="topbar-brand" gap="xs" wrap="nowrap">
              <div className="mark">TB</div>
              <Text className="topbar-title" fw={800} c="white">
                Gitdex
              </Text>
            </Group>
            <Group className="topbar-actions" gap={6} justify="flex-end" wrap="nowrap">
              <Badge color="dark" variant="light">
                Model <Code>{settings.codexModel}</Code>
              </Badge>
              <Badge color="dark" variant="light">
                Webhook <Code>{settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook</Code>
              </Badge>
              <SelfUpdateDialog version={packageJson.version} />
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
