import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

const requiredTokens = [
  "--app-bg",
  "--app-surface",
  "--app-surface-muted",
  "--app-text",
  "--app-text-muted",
  "--app-border",
  "--app-control-bg",
  "--app-control-border",
  "--app-focus-ring",
  "--app-interactive",
  "--app-interactive-hover",
  "--app-interactive-active"
];

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Expected ${selector} block in global CSS.`);
  return match[1];
}

describe("global theme tokens", () => {
  it("defines the shared light token categories on :root", () => {
    const rootBlock = blockFor(":root");

    for (const token of requiredTokens) {
      assert.match(rootBlock, new RegExp(`${token}:\\s*[^;]+;`), `Expected ${token} in :root.`);
    }
  });

  it("defines matching dark token categories for document theme switching", () => {
    const darkBlock = blockFor('html[data-theme="dark"]');

    for (const token of requiredTokens) {
      assert.match(darkBlock, new RegExp(`${token}:\\s*[^;]+;`), `Expected ${token} in dark theme.`);
    }
  });

  it("supports system dark mode before a stored manual preference is applied", () => {
    assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)/);
  });

  it("uses global tokens for document colors and focus styling", () => {
    assert.match(css, /body\s*\{[\s\S]*color:\s*var\(--app-text\);/);
    assert.match(css, /body\s*\{[\s\S]*var\(--app-bg\)/);
    assert.match(css, /outline:\s*2px solid var\(--app-focus-ring\);/);
  });
});
