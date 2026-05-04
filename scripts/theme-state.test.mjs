import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  createThemePreferenceState,
  nextThemeMode,
  normalizeThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveEffectiveTheme,
  themePalettes,
  themeStorageKey,
  updateSystemThemePreference,
  updateThemeMode
} from "../src/components/theme/theme-state.ts";
import { designTokens, staticTokens } from "../src/lib/design-tokens.ts";

const themeSelectorCss = readFileSync(new URL("../src/components/theme/theme-selector.module.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function createStorageMock(initialValue = null) {
  const writes = [];

  return {
    writes,
    getItem(key) {
      assert.equal(key, themeStorageKey);
      return initialValue;
    },
    setItem(key, value) {
      assert.equal(key, themeStorageKey);
      writes.push(value);
      initialValue = value;
    }
  };
}

function parseHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `Expected ${value} to be a six-digit hex color.`);
  const [, hex] = match;

  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function relativeLuminance(hexColor) {
  const [red, green, blue] = parseHexColor(hexColor).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function extractCssVariables(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `Expected ${selector} in globals.css.`);
  const blockStart = source.indexOf("{", start);
  let depth = 1;
  let index = blockStart + 1;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  return Object.fromEntries(
    Array.from(source.slice(blockStart + 1, index).matchAll(/\s*(--[\w-]+):\s*([^;]+);/g))
      .map(([, property, value]) => [property, value.trim()])
  );
}

describe("theme state helpers", () => {
  it("keeps theme selector interaction colors on shared tokens", () => {
    assert.match(themeSelectorCss, /\.toggle:focus-visible\s*\{[\s\S]*var\(--app-focus-ring\)/);
    assert.match(themeSelectorCss, /\.toggle\[data-mode="dark"\]\s*\{[\s\S]*var\(--app-filled-control-text\)/);
    assert.match(themeSelectorCss, /\.toggle\[data-mode="dark"\]\s*\{[\s\S]*var\(--app-interactive-active\)/);
    assert.match(themeSelectorCss, /:global\(html\[data-theme="dark"\] \.auth-form button\)\s*\{[\s\S]*var\(--app-filled-control-text\)/);
    assert.doesNotMatch(themeSelectorCss, /#[0-9a-fA-F]{3,8}/);
  });

  it("keeps dark filled form controls readable against their shared filled background", () => {
    assert.ok(
      contrastRatio(themePalettes.dark["--app-filled-control-text"], "#1f2937") >= 4.5,
      "Expected dark filled form control text to keep at least 4.5:1 contrast."
    );
  });

  it("exposes matching shared UI tokens for bootstrap and client theme switching", () => {
    const requiredTokens = [
      "--app-bg",
      "--app-bg-rgb",
      "--app-bg-wash",
      "--app-shell",
      "--app-surface",
      "--app-surface-muted",
      "--app-surface-subtle",
      "--app-border",
      "--app-border-muted",
      "--app-text",
      "--app-text-strong",
      "--app-text-muted",
      "--app-text-inverted",
      "--app-control-bg",
      "--app-control-bg-muted",
      "--app-control-bg-hover",
      "--app-control-border",
      "--app-filled-control-text",
      "--app-focus-ring",
      "--app-interactive",
      "--app-interactive-hover",
      "--app-interactive-active",
      "--app-shadow-md",
      "--app-shadow-interactive"
    ];

    assert.deepEqual(Object.keys(themePalettes.light).sort(), Object.keys(themePalettes.dark).sort());

    for (const theme of ["light", "dark"]) {
      for (const token of requiredTokens) {
        assert.match(themePalettes[theme][token], /\S/, `Expected ${token} in ${theme} theme palette.`);
      }
    }
  });

  it("keeps the runtime palette sourced from design tokens", () => {
    assert.deepEqual(themePalettes, {
      light: Object.fromEntries(Object.entries(designTokens.light).filter(([token]) => token.startsWith("--app-"))),
      dark: Object.fromEntries(Object.entries(designTokens.dark).filter(([token]) => token.startsWith("--app-")))
    });
  });

  it("keeps globals.css app variables aligned with design tokens", () => {
    const lightCssTokens = extractCssVariables(globalsCss, ":root");
    const darkCssTokens = extractCssVariables(globalsCss, "html[data-theme=\"dark\"]");

    for (const [token, value] of Object.entries(designTokens.light)) {
      assert.equal(lightCssTokens[token], value, `Expected light ${token} to match design tokens.`);
    }

    for (const [token, value] of Object.entries(designTokens.dark)) {
      if (token in staticTokens) continue;
      assert.equal(darkCssTokens[token], value, `Expected dark ${token} to match design tokens.`);
    }
  });

  it("accepts only supported stored theme modes", () => {
    assert.equal(normalizeThemeMode("system"), "system");
    assert.equal(normalizeThemeMode("light"), "light");
    assert.equal(normalizeThemeMode("dark"), "dark");
    assert.equal(normalizeThemeMode("unexpected"), "system");
    assert.equal(normalizeThemeMode(null), "system");
  });

  it("resolves system mode from the operating system preference", () => {
    assert.equal(resolveEffectiveTheme("system", false), "light");
    assert.equal(resolveEffectiveTheme("system", true), "dark");
  });

  it("keeps explicit light and dark modes independent of system preference", () => {
    assert.equal(resolveEffectiveTheme("light", false), "light");
    assert.equal(resolveEffectiveTheme("light", true), "light");
    assert.equal(resolveEffectiveTheme("dark", false), "dark");
    assert.equal(resolveEffectiveTheme("dark", true), "dark");
  });

  it("reads persisted light and dark modes as manual overrides", () => {
    assert.equal(readStoredThemeMode(createStorageMock("light")), "light");
    assert.equal(readStoredThemeMode(createStorageMock("dark")), "dark");
  });

  it("falls back to system mode for missing, unsupported, or unreadable storage", () => {
    assert.equal(readStoredThemeMode(createStorageMock(null)), "system");
    assert.equal(readStoredThemeMode(createStorageMock("sepia")), "system");
    assert.equal(
      readStoredThemeMode({
        getItem() {
          throw new Error("storage unavailable");
        },
        setItem() {}
      }),
      "system"
    );
  });

  it("persists manual and system mode selections under the theme storage key", () => {
    const storage = createStorageMock();

    assert.equal(persistThemeMode(storage, "light"), true);
    assert.equal(persistThemeMode(storage, "dark"), true);
    assert.equal(persistThemeMode(storage, "system"), true);
    assert.deepEqual(storage.writes, ["light", "dark", "system"]);
  });

  it("reports failed persistence without throwing", () => {
    assert.equal(
      persistThemeMode(
        {
          getItem() {
            return null;
          },
          setItem() {
            throw new Error("storage full");
          }
        },
        "dark"
      ),
      false
    );
  });

  it("keeps persisted manual preferences ahead of the mocked system scheme", () => {
    let state = createThemePreferenceState(
      readStoredThemeMode(createStorageMock("light")),
      true
    );
    assert.deepEqual(state, {
      mode: "light",
      prefersDark: true,
      effectiveTheme: "light"
    });

    state = updateSystemThemePreference(state, false);
    assert.deepEqual(state, {
      mode: "light",
      prefersDark: false,
      effectiveTheme: "light"
    });

    state = createThemePreferenceState(
      readStoredThemeMode(createStorageMock("dark")),
      false
    );
    assert.deepEqual(state, {
      mode: "dark",
      prefersDark: false,
      effectiveTheme: "dark"
    });

    state = updateSystemThemePreference(state, true);
    assert.deepEqual(state, {
      mode: "dark",
      prefersDark: true,
      effectiveTheme: "dark"
    });
  });

  it("updates system mode when the mocked operating system preference changes", () => {
    let state = createThemePreferenceState("system", false);
    assert.equal(state.effectiveTheme, "light");

    state = updateSystemThemePreference(state, true);
    assert.deepEqual(state, {
      mode: "system",
      prefersDark: true,
      effectiveTheme: "dark"
    });

    state = updateSystemThemePreference(state, false);
    assert.deepEqual(state, {
      mode: "system",
      prefersDark: false,
      effectiveTheme: "light"
    });
  });

  it("re-resolves effective theme when users switch modes", () => {
    let state = createThemePreferenceState("system", true);
    assert.equal(state.effectiveTheme, "dark");

    state = updateThemeMode(state, "light");
    assert.deepEqual(state, {
      mode: "light",
      prefersDark: true,
      effectiveTheme: "light"
    });

    state = updateThemeMode(state, "system");
    assert.deepEqual(state, {
      mode: "system",
      prefersDark: true,
      effectiveTheme: "dark"
    });
  });

  it("cycles the single theme toggle through system, light, and dark", () => {
    assert.equal(nextThemeMode("system"), "light");
    assert.equal(nextThemeMode("light"), "dark");
    assert.equal(nextThemeMode("dark"), "system");
  });

  it("uses a namespaced storage key", () => {
    assert.equal(themeStorageKey, "gitdex.theme.mode");
  });
});
