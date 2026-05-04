export type EffectiveTheme = "light" | "dark";

export type CssTokenMap = Record<`--${string}`, string>;

export const colorTokens: Record<EffectiveTheme, CssTokenMap> = {
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
    "--app-surface-glass": "rgba(255, 255, 255, 0.82)",
    "--app-surface-code-muted": "rgba(255, 255, 255, 0.78)",
    "--app-composer-fade-rgb": "248 251 255",
    "--app-border": "#dde5ee",
    "--app-border-strong": "#c8d1df",
    "--app-border-muted": "#e0e7f0",
    "--app-border-subtle": "#edf2f7",
    "--app-border-hover": "#b8c8dd",
    "--app-border-info": "#bfdbfe",
    "--app-border-danger": "#fecaca",
    "--app-border-success": "#bbf7d0",
    "--app-divider": "#e5edf6",
    "--app-divider-subtle": "#eef2f7",
    "--app-divider-danger": "#fee2e2",
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
    "--app-shadow-inset": "rgba(255, 255, 255, 0.82)",
    "--app-ring-info": "#e0f2fe",
    "--app-ring-danger": "#fee2e2",
    "--app-marker-muted": "#cbd5e1",
    "--app-user-message-bg": "#eef5ff",
    "--app-user-message-border": "#cfe0ff",
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
    "--app-surface-glass": "rgba(31, 42, 68, 0.86)",
    "--app-surface-code-muted": "rgba(2, 6, 23, 0.36)",
    "--app-composer-fade-rgb": "17 24 39",
    "--app-border": "#334155",
    "--app-border-strong": "#475569",
    "--app-border-muted": "#334155",
    "--app-border-subtle": "#26344c",
    "--app-border-hover": "#64748b",
    "--app-border-info": "#1d4ed8",
    "--app-border-danger": "#7f1d1d",
    "--app-border-success": "#166534",
    "--app-divider": "#334155",
    "--app-divider-subtle": "#26344c",
    "--app-divider-danger": "#7f1d1d",
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
    "--app-shadow-inset": "rgba(255, 255, 255, 0.05)",
    "--app-ring-info": "#1e3a66",
    "--app-ring-danger": "#3f1d24",
    "--app-marker-muted": "#64748b",
    "--app-user-message-bg": "#172c4f",
    "--app-user-message-border": "#1d4ed8",
    "--app-code-bg": "#020617",
    "--app-code-border": "#1e293b",
    "--app-code-text": "#dbeafe",
    "--app-scrollbar": "#64748b",
    "--app-scrollbar-hover": "#94a3b8"
  }
};

export const typographyTokens: CssTokenMap = {
  "--font-ui": "\"SF Pro Text\", \"Segoe UI\", system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  "--font-display": "\"SF Pro Display\", \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif",
  "--font-reading": "\"SF Pro Text\", \"Segoe UI\", system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  "--font-mono": "\"SFMono-Regular\", \"Cascadia Code\", \"Roboto Mono\", monospace",
  "--text-xs": "11px",
  "--text-sm": "12px",
  "--text-ui": "14px",
  "--text-md": "15px",
  "--text-chat": "15px",
  "--leading-tight": "1.25",
  "--leading-ui": "1.42",
  "--leading-reading": "1.68",
  "--weight-regular": "400",
  "--weight-medium": "560",
  "--weight-semibold": "700",
  "--weight-bold": "780",
  "--weight-extrabold": "850",
  "--weight-heavy": "850"
};

export const spaceTokens: CssTokenMap = {
  "--space-1": "4px",
  "--space-2": "8px",
  "--space-3": "12px",
  "--space-4": "16px",
  "--space-5": "20px",
  "--space-6": "24px",
  "--space-8": "32px"
};

export const radiusTokens: CssTokenMap = {
  "--radius-xs": "4px",
  "--radius-sm": "6px",
  "--radius-md": "8px",
  "--radius-lg": "12px",
  "--radius-pill": "999px"
};

export const zIndexTokens: CssTokenMap = {
  "--z-sticky": "5",
  "--z-overlay": "20",
  "--z-modal": "200"
};

export const staticTokens: CssTokenMap = {
  ...typographyTokens,
  ...spaceTokens,
  ...radiusTokens,
  ...zIndexTokens
};

export const themePalettes: Record<EffectiveTheme, CssTokenMap> = colorTokens;

export const designTokens: Record<EffectiveTheme, CssTokenMap> = {
  light: {
    ...colorTokens.light,
    ...staticTokens
  },
  dark: {
    ...colorTokens.dark,
    ...staticTokens
  }
};

export function cssVariables(tokens: CssTokenMap): string {
  return Object.entries(tokens)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join("\n");
}
