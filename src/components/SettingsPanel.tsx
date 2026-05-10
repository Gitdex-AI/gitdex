import { Alert, Badge, Button, Checkbox, Group, NumberInput, PasswordInput, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { Info, Save, Trash2, Webhook, Wrench } from "lucide-react";
import packageJson from "../../package.json";
import { SelfUpdateDialog } from "@/components/SelfUpdateDialog";
import { buildSettingsGroupState, type SettingsFieldState } from "@/components/settings/settings-field-model";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import {
  getMissingRequiredSettingsGroups,
  getSettings,
  type MissingRequiredSettingsGroup
} from "@/lib/settings";
import { settingsMetadataGroups } from "@/lib/settings-metadata";

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
  const settingsGroups = buildSettingsGroupState(settingsMetadataGroups, settings);
  const missingRequiredSettingsGroups = getMissingRequiredSettingsGroups(settings);

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
      <MissingConfigurationSummary groups={missingRequiredSettingsGroups} />
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
        {settingsGroups.map((group) => (
          <section key={group.id} className="settings-section" data-settings-group={group.id}>
            <div className="settings-section-heading">
              <div>
                <Text className="settings-section-title">{group.label}</Text>
                <Text className="settings-row-description">{group.description}</Text>
              </div>
            </div>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {group.settings.map((field) => (
                <SettingsField key={field.key} field={field} />
              ))}
            </SimpleGrid>
          </section>
        ))}
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
      </form>
    </div>
  );
}

function MissingConfigurationSummary({ groups }: { groups: MissingRequiredSettingsGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <section className="settings-missing-summary" aria-labelledby="settings-missing-summary-title">
      <div>
        <Text id="settings-missing-summary-title" className="settings-missing-summary-title">
          Missing required configuration
        </Text>
        <Text className="settings-missing-summary-copy">
          Gitdex cannot complete the GitHub PR workflow end to end until the missing required Codex and GitHub configuration is provided.
        </Text>
      </div>
      <div className="settings-missing-summary-groups">
        {groups.map((group) => (
          <div key={group.groupId} className="settings-missing-summary-group">
            <Text className="settings-missing-summary-group-title">{group.groupLabel}</Text>
            <ul className="settings-missing-summary-list">
              {group.settings.map((setting) => (
                <li key={setting.key}>{setting.label}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReturnToInput({ returnTo }: { returnTo?: string }) {
  return returnTo ? <input type="hidden" name="next" value={returnTo} /> : null;
}

function SettingsField({ field }: { field: SettingsFieldState }) {
  const label = <SettingLabel field={field} />;
  const description = <SettingDescription field={field} />;
  const error = field.missingRequiredPrompt ?? undefined;

  if (field.key === "githubToken" || field.key === "telegramBotToken") {
    return (
      <PasswordInput
        name={field.key}
        label={label}
        description={description}
        defaultValue={String(field.value ?? "")}
        placeholder={field.key === "githubToken" ? "ghp_..." : "123456:ABC..."}
        error={error}
      />
    );
  }

  if (field.key === "worktreeRetentionDays") {
    return (
      <NumberInput
        name={field.key}
        label={label}
        description={description}
        min={1}
        max={365}
        defaultValue={Number(field.value)}
        error={error}
      />
    );
  }

  if (field.key === "autoCleanupCompletedWorktrees" || field.key === "rebuildWorktreeOnEnvironmentBlocked") {
    return (
      <Checkbox
        name={field.key}
        label={label}
        description={description}
        defaultChecked={Boolean(field.value)}
        error={error}
      />
    );
  }

  return (
    <TextInput
      name={field.key}
      label={label}
      description={description}
      defaultValue={String(field.value ?? "")}
      placeholder={getTextPlaceholder(field.key)}
      error={error}
    />
  );
}

function SettingLabel({ field }: { field: SettingsFieldState }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <span>{field.label}</span>
      <Badge size="xs" variant={field.requirement === "required" ? "filled" : "light"} color={field.requirement === "required" ? "red" : "gray"}>
        {field.requirement}
      </Badge>
    </Group>
  );
}

function SettingDescription({ field }: { field: SettingsFieldState }) {
  return (
    <Stack gap={2}>
      <Text span size="xs" c="dimmed">
        {field.purpose}
      </Text>
      <Text span size="xs" c="dimmed">
        {field.behaviorImpact}
      </Text>
    </Stack>
  );
}

function getTextPlaceholder(key: SettingsFieldState["key"]): string | undefined {
  if (key === "appBaseUrl") return "https://your-bot.example.com";
  if (key === "telegramWebhookSecret") return "secret-token";
  if (key === "githubRepo") return "owner/repo";
  return undefined;
}
