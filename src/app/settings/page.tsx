import { Alert, Badge, Button, Checkbox, Code, Group, NumberInput, Paper, PasswordInput, SimpleGrid, Text, TextInput, Textarea } from "@mantine/core";
import { GitBranch, Info, KeyRound, Save, Trash2, Webhook, Wrench } from "lucide-react";
import { PageTitle } from "@/components/PageTitle";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { getSettings } from "@/lib/settings";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildSettingsNextPath({ message, error }));
  const settings = await getSettings();
  const hasGitHubKey = Boolean(settings.githubUsername && settings.githubSshPrivateKeyPath && settings.githubSshPublicKey);

  return (
    <>
      <PageTitle title="Settings" />
      {(message || error) && (
        <Alert color={error ? "red" : "blue"} icon={<Info size={16} />} mb="md">
          {message ?? error}
        </Alert>
      )}
      <Paper mb="md">
        <Group justify="space-between" p="md">
          <div>
            <Text fw={760}>Tool Checks</Text>
            <Text size="sm" c="dimmed">
              Codex and GitHub CLI checks live on a dedicated Tools page.
            </Text>
          </div>
          <Button component="a" href="/tools" variant="light" leftSection={<Wrench size={16} />}>
            Open Tools
          </Button>
        </Group>
      </Paper>
      <Paper mb="md">
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>GitHub Owner</Text>
            <Badge color={hasGitHubKey ? "green" : "yellow"} variant="light">
              {hasGitHubKey ? "key ready" : "setup required"}
            </Badge>
            <Text size="sm" c="dimmed">
              Configure a GitHub user or organization owner before adding projects.
            </Text>
          </div>
        </Group>
        <div className="panel-body">
          <form method="post" action="/api/github/account">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="githubUsername" label="GitHub Owner" description="User or organization, for example octocat or my-org." defaultValue={settings.githubUsername} placeholder="owner-or-org" required />
              <TextInput label="SSH Private Key" value={settings.githubSshPrivateKeyPath || "not generated"} readOnly />
            </SimpleGrid>
            <Textarea
              label="SSH Public Key"
              description="Add this key to the GitHub user/org that owns the repositories."
              value={settings.githubSshPublicKey || "Generate a key first."}
              autosize
              minRows={3}
              readOnly
            />
            <Alert color="blue" icon={<Info size={16} />}>
              The private key is stored as a local file at the path above. SQLite stores only the GitHub owner, private key path, and public key text.
            </Alert>
            <Group className="form-actions">
              <Button type="submit" leftSection={<KeyRound size={16} />}>
                Save Account / Ensure SSH Key
              </Button>
              <Button component="a" href="https://github.com/settings/keys" target="_blank" variant="light" leftSection={<GitBranch size={16} />}>
                Open GitHub SSH Keys
              </Button>
            </Group>
            {settings.githubUsername && (
              <Text size="sm" c="dimmed" mt="sm">
                Add Project will list repositories owned by <Code>{settings.githubUsername}</Code> using your local <Code>gh</Code> login.
              </Text>
            )}
          </form>
        </div>
      </Paper>
      <Paper>
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Text fw={760}>Runtime Settings</Text>
            <Text size="sm" c="dimmed">
              Saved to data/gitdex.sqlite
            </Text>
          </div>
        </Group>
        <div className="panel-body">
          <form method="post" action="/api/settings">
            <Text className="section-title">App</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="appBaseUrl" label="App Base URL" defaultValue={settings.appBaseUrl} placeholder="https://your-bot.example.com" />
              <TextInput name="telegramWebhookSecret" label="Telegram Webhook Secret" defaultValue={settings.telegramWebhookSecret} placeholder="secret-token" />
            </SimpleGrid>
            <PasswordInput name="telegramBotToken" label="Telegram Bot Token" defaultValue={settings.telegramBotToken} placeholder="123456:ABC..." />

            <Text className="section-title">Codex CLI</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="codexBin" label="Codex Binary" defaultValue={settings.codexBin} />
              <TextInput name="codexHome" label="Codex Home" defaultValue={settings.codexHome} description="Must contain Codex login/auth state for bot execution." />
              <TextInput name="codexModel" label="Model" defaultValue={settings.codexModel} />
              <TextInput name="codexSandbox" label="Sandbox" defaultValue={settings.codexSandbox} />
              <TextInput name="codexApprovalPolicy" label="Approval Policy" defaultValue={settings.codexApprovalPolicy} />
            </SimpleGrid>

            <Text className="section-title">Fallback GitHub API</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput name="githubRepo" label="GitHub Repo" defaultValue={settings.githubRepo} placeholder="owner/repo" />
              <TextInput name="githubApiUrl" label="GitHub API URL" defaultValue={settings.githubApiUrl} />
            </SimpleGrid>
            <PasswordInput name="githubToken" label="GitHub Token" defaultValue={settings.githubToken} placeholder="ghp_..." />

            <Text className="section-title">Worktrees</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <NumberInput name="worktreeRetentionDays" label="Worktree Retention Days" min={1} max={365} defaultValue={settings.worktreeRetentionDays} />
              <div>
                <Checkbox name="autoCleanupCompletedWorktrees" label="Auto cleanup completed worktrees" defaultChecked={settings.autoCleanupCompletedWorktrees} mb="sm" />
                <Checkbox name="rebuildWorktreeOnEnvironmentBlocked" label="Rebuild worktree on environment blocked" defaultChecked={settings.rebuildWorktreeOnEnvironmentBlocked} />
              </div>
            </SimpleGrid>
            <Text size="sm" c="dimmed">
              Completed issue, QA, review, and archived recovery worktrees are local execution buffers. Gitdex keeps recent worktrees for diagnosis and removes older completed buffers after the retention window.
            </Text>

            <Group className="form-actions">
              <Button type="submit" leftSection={<Save size={16} />}>
                Save Settings
              </Button>
              <Button type="submit" variant="light" leftSection={<Webhook size={16} />} formAction="/api/setup/webhook">
                Setup Telegram Webhook
              </Button>
              <Button type="submit" variant="light" color="red" leftSection={<Trash2 size={16} />} formAction="/api/worktrees/cleanup">
                Clean Inactive Worktrees
              </Button>
            </Group>
          </form>
        </div>
      </Paper>
    </>
  );
}

function buildSettingsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}
