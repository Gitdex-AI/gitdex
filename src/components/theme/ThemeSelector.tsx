"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { nextThemeMode, type ThemeMode } from "./theme-state";
import { useTheme } from "./ThemeProvider";
import styles from "./theme-selector.module.css";

const themeLabels: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark"
};

const themeIcons = {
  system: Monitor,
  light: Sun,
  dark: Moon
};

export function ThemeSelector() {
  const { mode, setMode } = useTheme();
  const nextMode = nextThemeMode(mode);
  const Icon = themeIcons[mode];
  const label = `${themeLabels[mode]} theme`;
  const nextLabel = themeLabels[nextMode];

  return (
    <button
      aria-label={`${label}. Switch to ${nextLabel} theme`}
      className={styles.toggle}
      data-mode={mode}
      onClick={() => setMode(nextMode)}
      title={`${label}. Switch to ${nextLabel}`}
      type="button"
    >
      <Icon aria-hidden="true" size={17} strokeWidth={2.25} />
    </button>
  );
}
