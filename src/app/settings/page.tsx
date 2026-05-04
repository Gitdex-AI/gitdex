import { SettingsPanel } from "@/components/SettingsPanel";
import { requireConsolePageAuth } from "@/lib/console-auth";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const { message, error } = await searchParams;
  await requireConsolePageAuth(buildSettingsNextPath({ message, error }));
  return <SettingsPanel message={message} error={error} />;
}

function buildSettingsNextPath({ message, error }: { message?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message) params.set("message", message);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
}
