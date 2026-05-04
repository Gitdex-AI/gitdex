export const settingsReturnDirtyPrompt = "You have unsaved settings changes. Leave without saving?";

export function shouldAllowSettingsReturnNavigation(input: {
  isDirty: boolean;
  confirmLeave: (message: string) => boolean;
  prompt?: string;
}): boolean {
  if (!input.isDirty) return true;
  return input.confirmLeave(input.prompt ?? settingsReturnDirtyPrompt);
}

export function shouldAllowBrowserSettingsReturnNavigation(input: {
  isDirty: boolean;
  prompt?: string;
}): boolean {
  return shouldAllowSettingsReturnNavigation({
    ...input,
    confirmLeave: (message) => window.confirm(message)
  });
}
