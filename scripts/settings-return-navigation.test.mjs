import assert from "node:assert/strict";
import { test } from "node:test";
import {
  settingsReturnDirtyPrompt,
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
