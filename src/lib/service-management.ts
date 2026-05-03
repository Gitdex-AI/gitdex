export {
  getGitdexServiceRestartCommand,
  requestGitdexServiceRestart,
  resetGitdexServiceRestarterForTests,
  restartGitdexService,
  setGitdexServiceRestarterForTests
} from "@/lib/gitdex-service";

export type {
  GitdexServiceManager,
  GitdexServiceRestartResponse,
  GitdexServiceRestartResult
} from "@/lib/gitdex-service";
