import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  getMissingRequiredSettingsGroups,
  settingsMetadataByKey
} from "../src/lib/settings-metadata.ts";

const completeRequiredSettings = {
  codexBin: "codex",
  codexHome: "/Users/example/.codex",
  codexModel: "gpt-5.4",
  codexSandbox: "workspace-write",
  codexApprovalPolicy: "never",
  githubRepo: "Gitdex-AI/gitdex",
  githubApiUrl: "https://api.github.com",
  githubToken: "ghp_example"
};

describe("settings missing configuration summary", () => {
  it("groups missing required settings by the labels used in the settings UI", () => {
    const groups = getMissingRequiredSettingsGroups({
      ...completeRequiredSettings,
      codexHome: " ",
      githubRepo: "",
      githubToken: undefined
    });

    assert.deepEqual(
      groups.map((group) => ({
        groupLabel: group.groupLabel,
        labels: group.settings.map((setting) => setting.label)
      })),
      [
        {
          groupLabel: "Codex",
          labels: [settingsMetadataByKey.codexHome.label]
        },
        {
          groupLabel: "GitHub",
          labels: [settingsMetadataByKey.githubRepo.label, settingsMetadataByKey.githubToken.label]
        }
      ]
    );
  });

  it("excludes optional blank settings from summary groups", () => {
    const groups = getMissingRequiredSettingsGroups({
      ...completeRequiredSettings,
      appBaseUrl: "",
      telegramBotToken: "",
      telegramWebhookSecret: ""
    });

    assert.deepEqual(groups, []);
  });

  it("returns no summary groups when required Codex and GitHub settings are complete", () => {
    assert.deepEqual(getMissingRequiredSettingsGroups(completeRequiredSettings), []);
  });

  it("wires the missing-configuration summary into SettingsPanel before grouped settings sections", () => {
    const source = readFileSync(new URL("../src/components/SettingsPanel.tsx", import.meta.url), "utf8");

    assert.match(source, /Gitdex cannot complete the GitHub PR workflow end to end/);
    assert.ok(source.indexOf("<MissingConfigurationSummary") < source.indexOf("<section className=\"settings-section\">"));
    assert.ok(source.includes("getMissingRequiredSettingsGroups(settings)"));
  });
});
