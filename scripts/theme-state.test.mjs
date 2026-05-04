import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createThemePreferenceState,
  normalizeThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveEffectiveTheme,
  themeStorageKey,
  updateSystemThemePreference,
  updateThemeMode
} from "../src/components/theme/theme-state.ts";

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

describe("theme state helpers", () => {
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

  it("uses a namespaced storage key", () => {
    assert.equal(themeStorageKey, "gitdex.theme.mode");
  });
});
