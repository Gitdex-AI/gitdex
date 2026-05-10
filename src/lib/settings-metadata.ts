import type { Settings } from "./types";

export type SettingsMetadataGroupId = "runtime" | "telegram" | "codex" | "github" | "worktrees";
export type SettingRequirement = "required" | "optional";

export type SettingMetadata = {
  key: keyof Settings;
  label: string;
  requirement: SettingRequirement;
  purpose: string;
  behaviorImpact: string;
};

export type SettingsMetadataGroup = {
  id: SettingsMetadataGroupId;
  label: string;
  description: string;
  settings: readonly SettingMetadata[];
};

export type MissingRequiredSetting = SettingMetadata & {
  groupId: SettingsMetadataGroupId;
  groupLabel: string;
  value: Settings[keyof Settings] | undefined;
};

export type MissingRequiredSettingsGroup = {
  groupId: SettingsMetadataGroupId;
  groupLabel: string;
  settings: MissingRequiredSetting[];
};

export const settingsMetadataGroups: readonly SettingsMetadataGroup[] = [
  {
    id: "runtime",
    label: "Runtime",
    description: "Local Gitdex server and browser-facing runtime settings.",
    settings: [
      {
        key: "appBaseUrl",
        label: "App Base URL",
        requirement: "optional",
        purpose: "Public base URL used when Gitdex needs to build links back to this app.",
        behaviorImpact: "Incorrect values can break webhook callbacks or links opened outside the local browser."
      }
    ]
  },
  {
    id: "telegram",
    label: "Telegram",
    description: "Telegram bot ingress configuration for chat-driven workflows.",
    settings: [
      {
        key: "telegramBotToken",
        label: "Telegram Bot Token",
        requirement: "optional",
        purpose: "Authenticates Gitdex when it sends or receives Telegram bot messages.",
        behaviorImpact: "Leaving it blank disables Telegram bot setup and webhook calls."
      },
      {
        key: "telegramWebhookSecret",
        label: "Telegram Webhook Secret",
        requirement: "optional",
        purpose: "Adds a shared secret check to incoming Telegram webhook requests.",
        behaviorImpact: "Leaving it blank accepts Telegram webhook requests without the secret-token guard."
      }
    ]
  },
  {
    id: "codex",
    label: "Codex",
    description: "Codex command and execution policy used by developer, QA, and architect jobs.",
    settings: [
      {
        key: "codexBin",
        label: "Codex Binary",
        requirement: "required",
        purpose: "Command Gitdex runs to start Codex agent sessions.",
        behaviorImpact: "Missing or invalid values prevent developer, QA, architect, and review jobs from starting."
      },
      {
        key: "codexHome",
        label: "Codex Home",
        requirement: "required",
        purpose: "Codex home directory containing local authentication and session state.",
        behaviorImpact: "Missing or invalid values prevent Codex from reusing the authenticated local account."
      },
      {
        key: "codexModel",
        label: "Model",
        requirement: "required",
        purpose: "Model identifier passed to Codex for agent execution.",
        behaviorImpact: "Missing values leave agent runs without an explicit model selection."
      },
      {
        key: "codexSandbox",
        label: "Sandbox",
        requirement: "required",
        purpose: "Filesystem sandbox policy passed to Codex agent runs.",
        behaviorImpact: "Missing values leave agent runs without the intended write-access boundary."
      },
      {
        key: "codexApprovalPolicy",
        label: "Approval Policy",
        requirement: "required",
        purpose: "Approval mode passed to Codex when it executes commands.",
        behaviorImpact: "Missing values leave command approval behavior undefined for automated jobs."
      }
    ]
  },
  {
    id: "github",
    label: "GitHub",
    description: "GitHub API configuration required to create issues, branches, pull requests, and labels.",
    settings: [
      {
        key: "githubRepo",
        label: "GitHub Repo",
        requirement: "required",
        purpose: "Default owner/repository target for GitHub workflow operations.",
        behaviorImpact: "Missing values prevent Gitdex from creating or updating issues, labels, and pull requests."
      },
      {
        key: "githubApiUrl",
        label: "GitHub API URL",
        requirement: "required",
        purpose: "GitHub API endpoint used by workflow automation.",
        behaviorImpact: "Missing values prevent GitHub client calls from resolving the API host."
      },
      {
        key: "githubToken",
        label: "GitHub Token",
        requirement: "required",
        purpose: "Token Gitdex uses to authenticate GitHub API requests.",
        behaviorImpact: "Missing values prevent authenticated repository, issue, label, and pull request operations."
      }
    ]
  },
  {
    id: "worktrees",
    label: "Worktrees",
    description: "Local worktree lifecycle settings for agent job retries and cleanup.",
    settings: [
      {
        key: "worktreeRetentionDays",
        label: "Worktree Retention Days",
        requirement: "optional",
        purpose: "Number of days completed local worktrees are retained before cleanup.",
        behaviorImpact: "Lower values reclaim disk faster; higher values keep more local debugging context."
      },
      {
        key: "autoCleanupCompletedWorktrees",
        label: "Auto cleanup completed worktrees",
        requirement: "optional",
        purpose: "Controls whether completed worktrees are cleaned up after jobs finish.",
        behaviorImpact: "Disabling it keeps completed worktrees on disk until manually removed."
      },
      {
        key: "rebuildWorktreeOnEnvironmentBlocked",
        label: "Rebuild worktree on environment blocked",
        requirement: "optional",
        purpose: "Allows Gitdex to rebuild worktrees after environment-blocked agent runs.",
        behaviorImpact: "Disabling it leaves environment-blocked worktrees in place for manual inspection."
      }
    ]
  }
];

export const settingsMetadata: readonly SettingMetadata[] = settingsMetadataGroups.flatMap((group) => group.settings);

export const settingsMetadataByKey: Record<keyof Settings, SettingMetadata> = Object.fromEntries(
  settingsMetadata.map((setting) => [setting.key, setting])
) as Record<keyof Settings, SettingMetadata>;

export function getMissingRequiredSettings(settings: Partial<Settings>): MissingRequiredSetting[] {
  return settingsMetadataGroups.flatMap((group) =>
    group.settings
      .filter((setting) => setting.requirement === "required" && isMissingSettingValue(settings[setting.key]))
      .map((setting) => ({
        ...setting,
        groupId: group.id,
        groupLabel: group.label,
        value: settings[setting.key]
      }))
  );
}

export function getMissingRequiredSettingsGroups(settings: Partial<Settings>): MissingRequiredSettingsGroup[] {
  const missingSettings = getMissingRequiredSettings(settings);
  return settingsMetadataGroups
    .map((group) => ({
      groupId: group.id,
      groupLabel: group.label,
      settings: missingSettings.filter((setting) => setting.groupId === group.id)
    }))
    .filter((group) => group.settings.length > 0);
}

function isMissingSettingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}
