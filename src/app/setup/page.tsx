"use client";

import { FormEvent, useState } from "react";

export default function SetupPage() {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);

    const response = await fetch("/api/admin/setup", {
      method: "POST",
      body: new FormData(event.currentTarget)
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setMessage("Admin created. Redirecting to login.");
      window.location.assign("/login");
      return;
    }

    setMessage(body.error || "Setup failed.");
    setSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="setup-title">
        <h1 id="setup-title">Gitdex Setup</h1>
        <form className="auth-form" onSubmit={submitSetup}>
          <label>
            Username
            <input name="username" defaultValue="admin" autoComplete="username" />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="new-password" autoFocus />
          </label>
          <p className="auth-message" role="alert">{message}</p>
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create admin"}
          </button>
        </form>
        <a href="/login">Log in</a>
      </section>
    </main>
  );
}
