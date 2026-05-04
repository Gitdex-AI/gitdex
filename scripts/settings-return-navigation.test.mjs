import assert from "node:assert/strict";
import { test } from "node:test";
import {
  shouldAllowBrowserSettingsReturnNavigation,
  settingsReturnDirtyPrompt,
  shouldGuardWorkspaceSettingsReturn,
  shouldAllowSettingsReturnNavigation
} from "../src/components/settings/settings-return-policy.ts";

test("settings return navigation proceeds without prompting when forms are unchanged", () => {
  let prompted = false;
  const allowed = shouldAllowSettingsReturnNavigation({
    isDirty: false,
    confirmLeave: () => {
      prompted = true;
      return false;
    }
  });

  assert.equal(allowed, true);
  assert.equal(prompted, false);
});

test("settings return navigation is prevented when unsaved confirmation is cancelled", () => {
  const allowed = shouldAllowSettingsReturnNavigation({
    isDirty: true,
    confirmLeave: (message) => {
      assert.equal(message, settingsReturnDirtyPrompt);
      return false;
    }
  });

  assert.equal(allowed, false);
});

test("settings return navigation proceeds when unsaved confirmation is accepted", () => {
  const allowed = shouldAllowSettingsReturnNavigation({
    isDirty: true,
    confirmLeave: (message) => {
      assert.equal(message, settingsReturnDirtyPrompt);
      return true;
    }
  });

  assert.equal(allowed, true);
});

test("workspace settings back control is guarded by dirty settings confirmation", () => {
  assert.equal(shouldGuardWorkspaceSettingsReturn({ panel: "settings" }), true);
  assert.equal(shouldGuardWorkspaceSettingsReturn({ panel: "tools" }), false);
  assert.equal(shouldGuardWorkspaceSettingsReturn({ panel: "projects" }), false);
  assert.equal(shouldGuardWorkspaceSettingsReturn({ panel: "requirements" }), false);
  assert.equal(shouldGuardWorkspaceSettingsReturn({ panel: null }), false);
});

test("browser settings return confirmation preserves the window receiver", () => {
  const previousWindow = globalThis.window;
  const fakeWindow = {
    confirm(message) {
      assert.equal(this, fakeWindow);
      assert.equal(message, settingsReturnDirtyPrompt);
      return false;
    }
  };

  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true
  });

  try {
    const allowed = shouldAllowBrowserSettingsReturnNavigation({ isDirty: true });
    assert.equal(allowed, false);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        value: previousWindow,
        configurable: true
      });
    }
  }
});
