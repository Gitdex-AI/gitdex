import { Alert, Badge, Button, Checkbox, Group, NativeSelect, SimpleGrid, Text, TextInput } from "@mantine/core";
import { ArrowLeft, FolderPlus, Info, KeyRound, ShieldCheck } from "lucide-react";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listLocalGitHubRepos } from "@/lib/github-local";
import { getSettings } from "@/lib/settings";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  await requireConsolePageAuth(error ? `/projects/new?error=${encodeURIComponent(error)}` : "/projects/new");
  const settings = await getSettings();
  const repos = settings.githubUsername ? await safeListRepos(settings.githubUsername) : [];
  const hasGitHubAccount = Boolean(settings.githubUsername && settings.githubSshPublicKey);

  return (
    <div className="project-new-panel">
      <Button component="a" href="/" variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} mb="sm">
        Back to workspace
      </Button>
      <div className="settings-page-heading">
        <Text className="settings-page-title">Add Project</Text>
        <Text size="sm" c="dimmed">
          Connect a GitHub repository to a Gitdex workspace.
        </Text>
      </div>
      {error && (
        <Alert color="red" icon={<Info size={16} />} mb="md">
          {error}
        </Alert>
      )}
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <Group gap="xs" align="center">
              <Text className="settings-section-title">GitHub Repository</Text>
              <Badge variant="light" color="blue" size="sm">
                Required
              </Badge>
            </Group>
            <Text className="settings-row-description">Select a repository from the configured GitHub user or organization.</Text>
          </div>
        </div>
        {!hasGitHubAccount && (
          <Alert color="yellow" icon={<Info size={16} />} mb="md">
            <Text size="sm" mb="sm">
              No usable GitHub owner is configured yet. Enter a GitHub user or organization and generate an SSH key before adding a project.
            </Text>
            <form method="post" action="/api/github/account">
              <input type="hidden" name="next" value="/projects/new" />
              <Group align="flex-end" gap="sm">
                <TextInput name="githubUsername" label="GitHub Owner" placeholder="owner-or-org" required />
                <Button type="submit" variant="light" leftSection={<KeyRound size={16} />}>
                  Ensure SSH Key
                </Button>
              </Group>
            </form>
          </Alert>
        )}
        <form className="settings-form" method="post" action="/api/projects">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput name="projectName" label="Project Name" placeholder="Mobile App" required />
            <TextInput name="githubAccount" label="GitHub Owner" defaultValue={settings.githubUsername || "not configured"} readOnly />
            <NativeSelect
              name="githubRepo"
              label="GitHub Repo"
              data={repos.length ? repos.map((repo) => ({ value: repo.nameWithOwner, label: `${repo.nameWithOwner}${repo.isPrivate ? " private" : ""}` })) : [{ value: "", label: "No repositories available" }]}
              required
            />
            <TextInput
              name="agentsFilePath"
              label="Agent Instructions File"
              defaultValue="AGENTS.md"
              required
            />
          </SimpleGrid>
          <div className="settings-checkbox-stack project-new-checkboxes">
            <Checkbox
              name="updateAgentsFile"
              value="true"
              label="Update AGENTS.md in the selected repository"
            />
            <Checkbox
              name="autoDeploy"
              value="true"
              label="Enable automatic deployment after QA passes and architect approves merge"
            />
          </div>
          <Alert color="gray" icon={<ShieldCheck size={16} />}>
            Project creation always verifies the repository with your local gh login. Updating AGENTS.md is optional and may modify the remote repository.
          </Alert>
          <Group className="form-actions">
            <Button type="submit" disabled={!hasGitHubAccount || !repos.length} leftSection={<FolderPlus size={16} />}>
              Add Project
            </Button>
          </Group>
        </form>
      </section>
    </div>
  );
}

async function safeListRepos(owner: string) {
  try {
    return await listLocalGitHubRepos(owner);
  } catch {
    return [];
  }
}
