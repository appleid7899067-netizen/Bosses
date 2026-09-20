import { createServerFn } from "@tanstack/react-start";

export const executeAuthenticatedGitHubTool = createServerFn({ method: "POST" })
  .validator((value: { toolName: string; args: Record<string, unknown> }) => value)
  .handler(async ({ data }) => {
    const { githubActions, githubCreateBranch, githubCreateIssue, githubCreatePullRequest, githubDispatchWorkflow, githubStatus, githubWaitForWorkflow, githubWriteFile } = await import("@/lib/github-app.server");
    const owner = String(data.args.owner ?? "").trim();
    const repo = String(data.args.repo ?? "").trim();
    if (!owner || !repo) throw new Error("GitHub requires owner and repo.");
    switch (data.toolName) {
      case "github_write_file": return githubWriteFile({ owner, repo, path: String(data.args.path ?? ""), content: String(data.args.content ?? ""), message: String(data.args.message ?? "Bossnu update"), sha: data.args.sha ? String(data.args.sha) : undefined, branch: data.args.branch ? String(data.args.branch) : undefined });
      case "github_create_branch": return githubCreateBranch({ owner, repo, branch: String(data.args.branch ?? ""), from: data.args.from ? String(data.args.from) : undefined });
      case "github_create_pull_request": return githubCreatePullRequest({ owner, repo, head: String(data.args.head ?? ""), base: data.args.base ? String(data.args.base) : undefined, title: String(data.args.title ?? ""), body: data.args.body ? String(data.args.body) : undefined });
      case "github_create_issue": return githubCreateIssue({ owner, repo, title: String(data.args.title ?? ""), body: data.args.body ? String(data.args.body) : undefined });
      case "github_actions": return githubActions({ owner, repo, branch: data.args.branch ? String(data.args.branch) : undefined });
      case "github_dispatch_workflow": return githubDispatchWorkflow({ owner, repo, workflow: String(data.args.workflow ?? ""), branch: data.args.branch ? String(data.args.branch) : undefined, inputs: data.args.inputs && typeof data.args.inputs === "object" ? data.args.inputs as Record<string, string> : undefined });
      case "github_wait_for_workflow": return githubWaitForWorkflow({ owner, repo, runId: Number(data.args.runId), timeoutMs: data.args.timeoutMs ? Number(data.args.timeoutMs) : undefined, pollMs: data.args.pollMs ? Number(data.args.pollMs) : undefined });
      case "github_get_repo": return githubStatus(owner, repo);
      default: throw new Error(`Unknown authenticated GitHub tool: ${data.toolName}`);
    }
  });
