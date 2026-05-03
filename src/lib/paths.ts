import path from "node:path";

export const rootDir = process.cwd();
export const dataDir = process.env.DATA_DIR?.trim() || path.join(rootDir, "data");
export const workflowsDir = path.join(dataDir, "workflows");
export const projectsDir = path.join(dataDir, "projects");
export const chatProjectsDir = path.join(dataDir, "chat-projects");
export const runtimeConfigPath = path.join(dataDir, "runtime-config.json");
export const databasePath = path.join(dataDir, "gitdex.sqlite");
