import { Alert, Badge, Button, Checkbox, Group, NativeSelect, SimpleGrid, Text, TextInput } from "@mantine/core";
import { ArrowLeft, FolderPlus, Info, Search, ShieldCheck } from "lucide-react";
import { requireConsolePageAuth } from "@/lib/console-auth";
import { listLocalGitHubRepos } from "@/lib/github-local";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ error?: string; owner?: string }> }) {
  const { error, owner: ownerParam } = await searchParams;
  const owner = String(ownerParam ?? "").trim();
  const currentPath = `/projects/new${owner ? `?owner=${encodeURIComponent(owner)}` : ""}${error ? `${owner ? "&" : "?"}error=${encodeURIComponent(error)}` : ""}`;
  await requireConsolePageAuth(currentPath);
  const repos = owner ? await safeListRepos(owner) : [];

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
            <Text className="settings-row-description">Enter the GitHub user or organization for this project, then select one of its repositories.</Text>
          </div>
        </div>
        <form method="get" className="settings-form">
          <Group align="flex-end" gap="sm">
            <TextInput name="owner" label="GitHub Owner" placeholder="owner-or-org" defaultValue={owner} required />
            <Button type="submit" variant="light" leftSection={<Search size={16} />}>
              Load Repos
            </Button>
          </Group>
        </form>
        {owner && !repos.length ? (
          <Alert color="yellow" icon={<Info size={16} />} mt="md" mb="md">
            No repositories were found for this owner with the current gh login.
          </Alert>
        ) : null}
        <form className="settings-form" method="post" action="/api/projects">
          <input type="hidden" name="githubAccount" value={owner} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput name="projectName" label="Project Name" placeholder="Mobile App" required />
            <NativeSelect
              name="githubRepo"
              label="GitHub Repo"
              data={repos.length ? repos.map((repo) => ({ value: repo.nameWithOwner, label: `${repo.nameWithOwner}${repo.isPrivate ? " private" : ""}` })) : [{ value: "", label: owner ? "No repositories available" : "Load an owner first" }]}
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
            <Button type="submit" disabled={!owner || !repos.length} leftSection={<FolderPlus size={16} />}>
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
