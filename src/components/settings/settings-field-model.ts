import type { SettingMetadata, SettingsMetadataGroup } from "../../lib/settings-metadata";
import type { Settings } from "../../lib/types";

export type SettingsFieldState = SettingMetadata & {
  value: Settings[keyof Settings];
  missingRequired: boolean;
  missingRequiredPrompt: string | null;
};

export type SettingsGroupState = Omit<SettingsMetadataGroup, "settings"> & {
  settings: SettingsFieldState[];
};

export function buildSettingsGroupState(groups: readonly SettingsMetadataGroup[], settings: Settings): SettingsGroupState[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    settings: group.settings.map((setting) => {
      const value = settings[setting.key];
      const missingRequired = setting.requirement === "required" && isMissingSettingValue(value);

      return {
        ...setting,
        value,
        missingRequired,
        missingRequiredPrompt: missingRequired
          ? `${setting.label} is required for the GitHub PR workflow. ${setting.behaviorImpact}`
          : null
      };
    })
  }));
}

function isMissingSettingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}
