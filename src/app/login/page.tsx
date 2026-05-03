"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);

    const response = await fetch("/api/admin/login", {
      method: "POST",
      body: new FormData(event.currentTarget)
    });
    if (response.ok) {
      window.location.assign(getSafeNextPath());
      return;
    }

    const body = await response.json().catch(() => ({})) as { error?: string };
    setMessage(body.error || "Login failed.");
    setSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-title">
        <h1 id="login-title">Gitdex Console</h1>
        <form className="auth-form" onSubmit={submitLogin}>
          <label>
            Username
            <input name="username" defaultValue="admin" autoComplete="username" />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" autoFocus />
          </label>
          <p className="auth-message" role="alert">{message}</p>
          <button type="submit" disabled={submitting}>
            {submitting ? "Logging in..." : "Log in"}
          </button>
        </form>
        <a href="/setup">First-run setup</a>
      </section>
    </main>
  );
}

function getSafeNextPath(): string {
  const nextPath = new URLSearchParams(window.location.search).get("next");
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) return "/";
  return nextPath;
}
