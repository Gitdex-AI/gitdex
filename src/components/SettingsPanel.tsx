import { Alert, Button, Checkbox, Group, NumberInput, PasswordInput, SimpleGrid, Text, TextInput } from "@mantine/core";
import { Info, Save, Trash2, Webhook, Wrench } from "lucide-react";
import packageJson from "../../package.json";
import { SelfUpdateDialog } from "@/components/SelfUpdateDialog";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { getSettings } from "@/lib/settings";

export async function SettingsPanel({
  message,
  error,
  returnTo,
  toolsHref = "/"
}: {
  message?: string;
  error?: string;
  returnTo?: string;
  toolsHref?: string;
}) {
  const settings = await getSettings();

  return (
    <div className="settings-panel">
      <div className="settings-page-heading">
        <Text className="settings-page-title">Settings</Text>
        <Text size="sm" c="dimmed">
          Configure local workspace behavior and integration defaults.
        </Text>
      </div>
      {(message || error) && (
        <Alert color={error ? "red" : "blue"} icon={<Info size={16} />} mb="md">
          {message ?? error}
        </Alert>
      )}
      <section className="settings-section">
        <div className="settings-row">
          <div className="settings-row-copy">
            <Text className="settings-row-title">Appearance</Text>
            <Text className="settings-row-description">Switch between system, light, and dark themes.</Text>
          </div>
          <ThemeSelector />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-row">
          <div className="settings-row-copy">
            <Text className="settings-row-title">Tool Checks</Text>
            <Text className="settings-row-description">Codex and GitHub CLI checks live on a dedicated Tools page.</Text>
          </div>
          <Button component="a" href={toolsHref} variant="light" leftSection={<Wrench size={16} />}>
            Open Tools
          </Button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-row">
          <div className="settings-row-copy">
            <Text className="settings-row-title">Gitdex Update</Text>
            <Text className="settings-row-description">Current version v{packageJson.version}. Pull, build, and restart Gitdex when self-update is enabled.</Text>
          </div>
          <SelfUpdateDialog version={packageJson.version} triggerLabel="Update Gitdex" triggerVariant="button" />
        </div>
      </section>

      <form method="post" action="/api/settings" data-settings-form className="settings-form">
        <ReturnToInput returnTo={returnTo} />
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <Text className="settings-section-title">Runtime</Text>
              <Text className="settings-row-description">Saved to data/gitdex.sqlite.</Text>
            </div>
          </div>
          <div className="settings-subsection">
            <Text className="section-title">App</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="appBaseUrl" label="App Base URL" defaultValue={settings.appBaseUrl} placeholder="https://your-bot.example.com" />
              <TextInput name="telegramWebhookSecret" label="Telegram Webhook Secret" defaultValue={settings.telegramWebhookSecret} placeholder="secret-token" />
            </SimpleGrid>
            <PasswordInput name="telegramBotToken" label="Telegram Bot Token" defaultValue={settings.telegramBotToken} placeholder="123456:ABC..." />
          </div>
          <div className="settings-subsection">
            <Text className="section-title">Codex CLI</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="codexBin" label="Codex Binary" defaultValue={settings.codexBin} />
              <TextInput name="codexHome" label="Codex Home" defaultValue={settings.codexHome} />
              <TextInput name="codexModel" label="Model" defaultValue={settings.codexModel} />
              <TextInput name="codexSandbox" label="Sandbox" defaultValue={settings.codexSandbox} />
              <TextInput name="codexApprovalPolicy" label="Approval Policy" defaultValue={settings.codexApprovalPolicy} />
            </SimpleGrid>
          </div>
          <div className="settings-subsection">
            <Text className="section-title">Fallback GitHub API</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="githubRepo" label="GitHub Repo" defaultValue={settings.githubRepo} placeholder="owner/repo" />
              <TextInput name="githubApiUrl" label="GitHub API URL" defaultValue={settings.githubApiUrl} />
            </SimpleGrid>
            <PasswordInput name="githubToken" label="GitHub Token" defaultValue={settings.githubToken} placeholder="ghp_..." />
          </div>
          <div className="settings-subsection">
            <Text className="section-title">Worktrees</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <NumberInput name="worktreeRetentionDays" label="Worktree Retention Days" min={1} max={365} defaultValue={settings.worktreeRetentionDays} />
              <div className="settings-checkbox-stack">
                <Checkbox name="autoCleanupCompletedWorktrees" label="Auto cleanup completed worktrees" defaultChecked={settings.autoCleanupCompletedWorktrees} />
                <Checkbox name="rebuildWorktreeOnEnvironmentBlocked" label="Rebuild worktree on environment blocked" defaultChecked={settings.rebuildWorktreeOnEnvironmentBlocked} />
              </div>
            </SimpleGrid>
            <Text size="sm" c="dimmed">
              Completed worktrees are local execution buffers. Gitdex keeps recent buffers for diagnosis and removes older completed buffers after the retention window.
            </Text>
          </div>
          <Group className="form-actions">
            <Button type="submit" leftSection={<Save size={16} />}>
              Save Settings
            </Button>
            <Button type="submit" variant="light" leftSection={<Webhook size={16} />} formAction="/api/setup/webhook">
              Setup Webhook
            </Button>
            <Button type="submit" variant="light" color="red" leftSection={<Trash2 size={16} />} formAction="/api/worktrees/cleanup">
              Clean Worktrees
            </Button>
          </Group>
        </section>
      </form>
    </div>
  );
}

function ReturnToInput({ returnTo }: { returnTo?: string }) {
  return returnTo ? <input type="hidden" name="next" value={returnTo} /> : null;
}
