import { themePalettes, type EffectiveTheme as DesignEffectiveTheme } from "../../lib/design-tokens.ts";

export const themeStorageKey = "gitdex.theme.mode";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = DesignEffectiveTheme;
export type ThemeModeStorage = Pick<Storage, "getItem" | "setItem">;

export type ThemePreferenceState = {
  mode: ThemeMode;
  prefersDark: boolean;
  effectiveTheme: EffectiveTheme;
};

export const themeModes: ThemeMode[] = ["system", "light", "dark"];
export { themePalettes };

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeThemeMode(value: string | null): ThemeMode {
  return isThemeMode(value) ? value : "system";
}

export function resolveEffectiveTheme(
  mode: ThemeMode,
  prefersDark: boolean
): EffectiveTheme {
  if (mode === "system") {
    return prefersDark ? "dark" : "light";
  }

  return mode;
}

export function createThemePreferenceState(
  mode: ThemeMode,
  prefersDark: boolean
): ThemePreferenceState {
  return {
    mode,
    prefersDark,
    effectiveTheme: resolveEffectiveTheme(mode, prefersDark)
  };
}

export function updateThemeMode(
  state: ThemePreferenceState,
  mode: ThemeMode
): ThemePreferenceState {
  return createThemePreferenceState(mode, state.prefersDark);
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const currentIndex = themeModes.indexOf(mode);
  return themeModes[(currentIndex + 1) % themeModes.length] ?? "system";
}

export function updateSystemThemePreference(
  state: ThemePreferenceState,
  prefersDark: boolean
): ThemePreferenceState {
  return createThemePreferenceState(state.mode, prefersDark);
}

export function readStoredThemeMode(storage: ThemeModeStorage): ThemeMode {
  try {
    return normalizeThemeMode(storage.getItem(themeStorageKey));
  } catch (error) {
    return "system";
  }
}

export function persistThemeMode(
  storage: ThemeModeStorage,
  mode: ThemeMode
): boolean {
  try {
    storage.setItem(themeStorageKey, mode);
    return true;
  } catch (error) {
    return false;
  }
}
