import type { Metadata } from "next";
import { Group, Text } from "@mantine/core";
import { getSettings } from "@/lib/settings";
import { listProjects, listWorkflows } from "@/lib/store";
import { HeaderSecondaryActions } from "@/components/HeaderSecondaryActions";
import { Providers } from "@/components/Providers";
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
  const webhookUrl = `${settings.appBaseUrl.replace(/\/$/, "")}/telegram/webhook`;

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
            <Group className="topbar-actions" gap={6} justify="flex-start" wrap="nowrap">
              <HeaderSecondaryActions codexModel={settings.codexModel} webhookUrl={webhookUrl} version={packageJson.version} />
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
