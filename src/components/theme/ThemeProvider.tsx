"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  type EffectiveTheme,
  type ThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveEffectiveTheme,
  themePalettes
} from "./theme-state";
import { ThemeSelector } from "./ThemeSelector";

type ThemeContextValue = {
  mode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getStoredThemeMode() {
  return readStoredThemeMode(window.localStorage);
}

function storeThemeMode(mode: ThemeMode) {
  persistThemeMode(window.localStorage, mode);
}

function applyDocumentTheme(mode: ThemeMode, effectiveTheme: EffectiveTheme) {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.style.colorScheme = effectiveTheme;
  Object.entries(themePalettes[effectiveTheme]).forEach(([property, value]) => {
    document.documentElement.style.setProperty(property, value);
  });
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [prefersDark, setPrefersDark] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const effectiveTheme = resolveEffectiveTheme(mode, prefersDark);

  useEffect(() => {
    setModeState(getStoredThemeMode());
    setPrefersDark(getPrefersDark());
    setInitialized(true);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!initialized) {
      return;
    }

    applyDocumentTheme(mode, effectiveTheme);
  }, [effectiveTheme, initialized, mode]);

  const value = useMemo(
    () => ({
      mode,
      effectiveTheme,
      setMode: (nextMode: ThemeMode) => {
        storeThemeMode(nextMode);
        setModeState(nextMode);
      }
    }),
    [effectiveTheme, mode]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <ThemeSelector />
    </ThemeContext.Provider>
  );
}
