export const themeStorageKey = "gitdex.theme.mode";

export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type ThemeModeStorage = Pick<Storage, "getItem" | "setItem">;

export type ThemePreferenceState = {
  mode: ThemeMode;
  prefersDark: boolean;
  effectiveTheme: EffectiveTheme;
};

export const themeModes: ThemeMode[] = ["system", "light", "dark"];
export const themePalettes: Record<EffectiveTheme, Record<string, string>> = {
  light: {
    "--app-bg": "#f4f7fb",
    "--app-bg-rgb": "244 247 251",
    "--app-bg-wash": "rgba(37, 99, 235, 0.06)",
    "--app-bg-wash-rgb": "37 99 235",
    "--app-shell": "#ffffff",
    "--app-shell-rgb": "255 255 255",
    "--app-surface": "#ffffff",
    "--app-surface-muted": "#f8fbff",
    "--app-surface-subtle": "#f8fafc",
    "--app-surface-raised": "#ffffff",
    "--app-surface-danger": "#fff7f7",
    "--app-surface-danger-muted": "#fef2f2",
    "--app-surface-success": "#f0fdf4",
    "--app-surface-info": "#eff6ff",
    "--app-surface-running": "#f0f9ff",
    "--app-surface-blocked": "#fff1f2",
    "--app-border": "#dde5ee",
    "--app-border-strong": "#c8d1df",
    "--app-border-muted": "#e0e7f0",
    "--app-border-subtle": "#edf2f7",
    "--app-border-info": "#bfdbfe",
    "--app-border-danger": "#fecaca",
    "--app-border-success": "#bbf7d0",
    "--app-ink": "#172033",
    "--app-text": "#172033",
    "--app-text-strong": "#111827",
    "--app-text-muted": "#64748b",
    "--app-text-subtle": "#475569",
    "--app-text-inverted": "#ffffff",
    "--app-text-danger": "#b42318",
    "--app-text-link": "#1d4ed8",
    "--app-text-link-hover": "#1e40af",
    "--app-control-bg": "#ffffff",
    "--app-control-bg-muted": "#eff6ff",
    "--app-control-bg-hover": "#dbeafe",
    "--app-control-bg-active": "#eff6ff",
    "--app-control-border": "#bfdbfe",
    "--app-control-border-hover": "#93c5fd",
    "--app-control-text": "#1d4ed8",
    "--app-control-text-hover": "#1e40af",
    "--app-filled-control-text": "#ffffff",
    "--app-focus-ring": "#93c5fd",
    "--app-interactive": "#2563eb",
    "--app-interactive-hover": "#1d4ed8",
    "--app-interactive-active": "#1e40af",
    "--app-interactive-muted": "#eff6ff",
    "--app-danger": "#dc2626",
    "--app-success": "#16a34a",
    "--app-running": "#0284c7",
    "--app-shadow-sm": "rgba(15, 23, 42, 0.04)",
    "--app-shadow-md": "rgba(15, 23, 42, 0.08)",
    "--app-shadow-interactive": "rgba(37, 99, 235, 0.14)",
    "--app-code-bg": "#0f172a",
    "--app-code-border": "#1e293b",
    "--app-code-text": "#dbeafe",
    "--app-scrollbar": "#64748b",
    "--app-scrollbar-hover": "#94a3b8"
  },
  dark: {
    "--app-bg": "#0f172a",
    "--app-bg-rgb": "15 23 42",
    "--app-bg-wash": "rgba(56, 189, 248, 0.08)",
    "--app-bg-wash-rgb": "56 189 248",
    "--app-shell": "#172033",
    "--app-shell-rgb": "23 32 51",
    "--app-surface": "#172033",
    "--app-surface-muted": "#111827",
    "--app-surface-subtle": "#1e293b",
    "--app-surface-raised": "#1f2a44",
    "--app-surface-danger": "#331a22",
    "--app-surface-danger-muted": "#3f1d24",
    "--app-surface-success": "#123225",
    "--app-surface-info": "#172c4f",
    "--app-surface-running": "#113147",
    "--app-surface-blocked": "#3a1821",
    "--app-border": "#334155",
    "--app-border-strong": "#475569",
    "--app-border-muted": "#334155",
    "--app-border-subtle": "#26344c",
    "--app-border-info": "#1d4ed8",
    "--app-border-danger": "#7f1d1d",
    "--app-border-success": "#166534",
    "--app-ink": "#e5edf8",
    "--app-text": "#e5edf8",
    "--app-text-strong": "#f8fafc",
    "--app-text-muted": "#94a3b8",
    "--app-text-subtle": "#cbd5e1",
    "--app-text-inverted": "#0f172a",
    "--app-text-danger": "#fca5a5",
    "--app-text-link": "#93c5fd",
    "--app-text-link-hover": "#bfdbfe",
    "--app-control-bg": "#1f2a44",
    "--app-control-bg-muted": "#172c4f",
    "--app-control-bg-hover": "#1e3a66",
    "--app-control-bg-active": "#172c4f",
    "--app-control-border": "#1d4ed8",
    "--app-control-border-hover": "#60a5fa",
    "--app-control-text": "#bfdbfe",
    "--app-control-text-hover": "#dbeafe",
    "--app-filled-control-text": "#ffffff",
    "--app-focus-ring": "#60a5fa",
    "--app-interactive": "#60a5fa",
    "--app-interactive-hover": "#93c5fd",
    "--app-interactive-active": "#bfdbfe",
    "--app-interactive-muted": "#172c4f",
    "--app-danger": "#f87171",
    "--app-success": "#4ade80",
    "--app-running": "#38bdf8",
    "--app-shadow-sm": "rgba(0, 0, 0, 0.24)",
    "--app-shadow-md": "rgba(0, 0, 0, 0.32)",
    "--app-shadow-interactive": "rgba(96, 165, 250, 0.22)",
    "--app-code-bg": "#020617",
    "--app-code-border": "#1e293b",
    "--app-code-text": "#dbeafe",
    "--app-scrollbar": "#64748b",
    "--app-scrollbar-hover": "#94a3b8"
  }
};

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
