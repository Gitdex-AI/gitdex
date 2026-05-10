import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { settingsMetadataGroups } from "../src/lib/settings-metadata.ts";
import { buildSettingsGroupState } from "../src/components/settings/settings-field-model.ts";

const completeSettings = {
  appBaseUrl: "http://127.0.0.1:8000",
  telegramBotToken: "telegram-token",
  telegramWebhookSecret: "telegram-secret",
  codexBin: "codex",
  codexHome: "/Users/example/.codex",
  codexModel: "gpt-5.4",
  codexSandbox: "workspace-write",
  codexApprovalPolicy: "never",
  githubToken: "ghp_example",
  githubRepo: "Gitdex-AI/gitdex",
  githubApiUrl: "https://api.github.com",
  worktreeRetentionDays: 7,
  autoCleanupCompletedWorktrees: true,
  rebuildWorktreeOnEnvironmentBlocked: true
};

describe("settings page rendering contract", () => {
  it("builds one grouped field state for every settings metadata entry", () => {
    const groups = buildSettingsGroupState(settingsMetadataGroups, completeSettings);

    assert.deepEqual(
      groups.map((group) => group.id),
      settingsMetadataGroups.map((group) => group.id)
    );
    assert.deepEqual(
      groups.flatMap((group) => group.settings.map((field) => field.key)),
      settingsMetadataGroups.flatMap((group) => group.settings.map((field) => field.key))
    );

    for (const group of groups) {
      assert.ok(group.label);
      assert.ok(group.description);
      for (const field of group.settings) {
        assert.match(field.requirement, /^(required|optional)$/);
        assert.ok(field.purpose);
        assert.ok(field.behaviorImpact);
        assert.equal(field.missingRequired, false);
        assert.equal(field.missingRequiredPrompt, null);
      }
    }
  });

  it("adds local GitHub PR workflow prompts only to missing required fields", () => {
    const groups = buildSettingsGroupState(settingsMetadataGroups, {
      ...completeSettings,
      codexHome: " ",
      githubRepo: "",
      githubToken: ""
    });
    const fields = groups.flatMap((group) => group.settings);
    const missing = fields.filter((field) => field.missingRequired);

    assert.deepEqual(
      missing.map((field) => field.key),
      ["codexHome", "githubRepo", "githubToken"]
    );
    for (const field of missing) {
      assert.match(field.missingRequiredPrompt ?? "", /required for the GitHub PR workflow/);
      assert.match(field.missingRequiredPrompt ?? "", new RegExp(field.behaviorImpact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.equal(fields.find((field) => field.key === "appBaseUrl")?.missingRequired, false);
    assert.equal(fields.find((field) => field.key === "telegramBotToken")?.missingRequired, false);
  });

  it("wires the settings panel to metadata groups, labels, descriptions, and field prompts", async () => {
    const source = await readFile(new URL("../src/components/SettingsPanel.tsx", import.meta.url), "utf8");

    assert.match(source, /settingsMetadataGroups/);
    assert.match(source, /buildSettingsGroupState/);
    assert.match(source, /data-settings-group=\{group\.id\}/);
    assert.match(source, /field\.requirement/);
    assert.match(source, /field\.purpose/);
    assert.match(source, /field\.behaviorImpact/);
    assert.match(source, /field\.missingRequiredPrompt/);
  });
});
