import { Alert, Badge, Button, Checkbox, Group, NativeSelect, Paper, SimpleGrid, Text, TextInput, ThemeIcon } from "@mantine/core";
import { ArrowLeft, FolderPlus, GitBranch, Info, Settings, ShieldCheck } from "lucide-react";
import { PageTitle } from "@/components/PageTitle";
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
    <>
      <Button component="a" href="/projects" variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} mb="sm">
        Back to workspace
      </Button>
      <PageTitle title="Add Project" />
      {error && (
        <Alert color="red" icon={<Info size={16} />} mb="md">
          {error}
        </Alert>
      )}
      <Paper>
        <Group justify="space-between" p="md" className="section-header">
          <div>
            <Group gap="sm">
              <ThemeIcon variant="light" color="dark" radius="md">
                <GitBranch size={16} />
              </ThemeIcon>
              <Text fw={760}>Connect GitHub</Text>
              <Badge variant="light" color="blue">
                Required
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Select a repository from the GitHub user or organization configured in Settings.
            </Text>
          </div>
        </Group>
        {!hasGitHubAccount && (
          <Alert color="yellow" icon={<Info size={16} />} m="md">
            No usable GitHub owner is configured yet. Go to Settings, enter a GitHub user or organization, generate an SSH key, and add it to GitHub.
            <Button component="a" href="/settings" variant="light" mt="sm" leftSection={<Settings size={16} />}>
              Open Settings
            </Button>
          </Alert>
        )}
        <form className="project-form" method="post" action="/api/projects">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput name="projectName" label="Project Name" placeholder="Mobile App" required />
            <TextInput name="githubAccount" label="GitHub Owner" defaultValue={settings.githubUsername || "not configured"} readOnly />
            <NativeSelect
              name="githubRepo"
              label="GitHub Repo"
              description="Loaded from local gh login."
              data={repos.length ? repos.map((repo) => ({ value: repo.nameWithOwner, label: `${repo.nameWithOwner}${repo.isPrivate ? " private" : ""}` })) : [{ value: "", label: "No repositories available" }]}
              required
            />
            <TextInput
              name="agentsFilePath"
              label="Agent Instructions File"
              description="Used only when AGENTS update is enabled. Existing content outside Gitdex's managed block is preserved."
              defaultValue="AGENTS.md"
              required
            />
          </SimpleGrid>
          <Checkbox
            name="updateAgentsFile"
            value="true"
            mt="md"
            label="Update AGENTS.md in the selected repository"
            description="Enable only when you want Gitdex to commit or update the managed workflow section in the remote repo."
          />
          <Checkbox
            name="autoDeploy"
            value="true"
            mt="md"
            label="Enable automatic deployment after QA passes and architect approves merge"
            description="Leave disabled if the architect should stop at merge readiness and wait for manual deployment approval."
          />
          <Alert color="gray" icon={<ShieldCheck size={16} />} mt="md">
            Project creation always verifies the repository with your local gh login. Updating AGENTS.md is optional and may modify the remote repository.
          </Alert>
          <Button type="submit" disabled={!hasGitHubAccount || !repos.length} leftSection={<FolderPlus size={16} />} w={{ base: "100%", sm: "fit-content" }}>
            Connect GitHub & Add Project
          </Button>
        </form>
      </Paper>
    </>
  );
}

async function safeListRepos(owner: string) {
  try {
    return await listLocalGitHubRepos(owner);
  } catch {
    return [];
  }
}
