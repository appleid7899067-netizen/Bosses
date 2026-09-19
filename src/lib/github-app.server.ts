import { createSign } from "node:crypto";

const API = "https://api.github.com";
const API_VERSION = "2026-03-10";

type GitHubResponse<T> = {
  data: T;
  response: Response;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} environment variable`);
  return value;
}

function createAppJwt(): string {
  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKey = requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

async function github<T>(path: string, init: RequestInit = {}, token?: string): Promise<GitHubResponse<T>> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as T;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && data !== null && "message" in data
        ? String((data as { message?: unknown }).message)
        : response.statusText;
    throw new Error(`GitHub API ${response.status}: ${message}`);
  }
  return { data, response };
}

export async function githubAppInstallUrl(): Promise<string> {
  const jwt = createAppJwt();
  const result = await github<{ slug: string }>("/app", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  return `https://github.com/apps/${encodeURIComponent(result.data.slug)}/installations/new`;
}

async function getInstallationToken(owner: string, repo: string): Promise<string> {
  const jwt = createAppJwt();
  const installation = await github<{ id: number }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  const token = await github<{ token: string }>(
    `/app/installations/${installation.data.id}/access_tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
    },
  );
  return token.data.token;
}

function contentPath(owner: string, repo: string, path: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function githubGetFile(input: {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
  const result = await github<{
    name: string;
    path: string;
    sha: string;
    content?: string;
    encoding?: string;
    type: string;
    html_url?: string;
  }>(`${contentPath(input.owner, input.repo, input.path)}${ref}`, {}, token);
  const content = result.data.content
    ? Buffer.from(result.data.content.replace(/\n/g, ""), "base64").toString("utf8")
    : undefined;
  return { ...result.data, content };
}

export async function githubWriteFile(input: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
  branch?: string;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const result = await github<{
    content?: { path?: string; sha?: string; html_url?: string };
    commit?: { sha?: string; html_url?: string; message?: string };
  }>(contentPath(input.owner, input.repo, input.path), {
    method: "PUT",
    body: JSON.stringify({
      message: input.message,
      content: Buffer.from(input.content, "utf8").toString("base64"),
      ...(input.sha ? { sha: input.sha } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
    }),
  }, token);
  return result.data;
}

export async function githubStatus(owner: string, repo: string) {
  const token = await getInstallationToken(owner, repo);
  const result = await github<{
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
    description?: string | null;
    open_issues_count?: number;
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {}, token);
  return result.data;
}

export async function githubCreateBranch(input: {
  owner: string;
  repo: string;
  branch: string;
  from?: string;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const base = input.from || (await githubStatus(input.owner, input.repo)).default_branch;
  const ref = await github<{ object: { sha: string } }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/ref/heads/${encodeURIComponent(base)}`,
    {},
    token,
  );
  const result = await github<{ ref: string; object: { sha: string } }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: ref.data.object.sha }),
    },
    token,
  );
  return { branch: input.branch, from: base, ...result.data };
}

export async function githubCreatePullRequest(input: {
  owner: string;
  repo: string;
  head: string;
  base?: string;
  title: string;
  body?: string;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const base = input.base || (await githubStatus(input.owner, input.repo)).default_branch;
  const result = await github<{ number: number; html_url: string; title: string; state: string }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({ title: input.title, head: input.head, base, body: input.body || "Created by Bossnu SlieLo bot" }),
    },
    token,
  );
  return result.data;
}

export async function githubCreateIssue(input: {
  owner: string;
  repo: string;
  title: string;
  body?: string;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const result = await github<{ number: number; html_url: string; title: string; state: string }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues`,
    {
      method: "POST",
      body: JSON.stringify({ title: input.title, body: input.body || "Created by Bossnu SlieLo bot" }),
    },
    token,
  );
  return result.data;
}

export async function githubActions(input: { owner: string; repo: string; branch?: string }) {
  const token = await getInstallationToken(input.owner, input.repo);
  const result = await github<{
    total_count: number;
    workflow_runs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      head_branch: string | null;
      head_sha: string;
      html_url: string;
      created_at: string;
    }>;
  }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs?per_page=10${
      input.branch ? `&branch=${encodeURIComponent(input.branch)}` : ""
    }`,
    {},
    token,
  );
  return result.data;
}

async function githubText(path: string, token: string): Promise<string> {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

export async function githubWaitForWorkflow(input: { owner: string; repo: string; runId: number; timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 120_000, 5_000), 300_000);
  const pollMs = Math.min(Math.max(input.pollMs ?? 3_000, 1_000), 15_000);
  const deadline = Date.now() + timeoutMs;
  const token = await getInstallationToken(input.owner, input.repo);
  while (Date.now() < deadline) {
    const result = await github<{ id: number; status: string; conclusion: string | null; html_url: string; head_branch: string | null }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}`,
      {}, token,
    );
    if (result.data.status === "completed") {
      return { ...result.data, verified: result.data.conclusion === "success" };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { runId: input.runId, status: "timeout", conclusion: null, verified: false };
}

export async function githubWorkflowDiagnostics(input: { owner: string; repo: string; runId: number }) {
  const token = await getInstallationToken(input.owner, input.repo);
  const jobs = await github<{ jobs: Array<{ id: number; name: string; status: string; conclusion: string | null; steps?: Array<{ name: string; status: string; conclusion: string | null }> }> }>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}/jobs?per_page=20`,
    {}, token,
  );
  const failedJobs = jobs.data.jobs.filter((job) => job.conclusion === "failure" || job.conclusion === "cancelled");
  const diagnostics = [] as Array<{ jobId: number; name: string; conclusion: string | null; log: string }>;
  for (const job of failedJobs.slice(0, 3)) {
    const log = await githubText(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/jobs/${job.id}/logs`,
      token,
    );
    diagnostics.push({ jobId: job.id, name: job.name, conclusion: job.conclusion, log: log.slice(-16000) });
  }
  return { runId: input.runId, jobs: jobs.data.jobs, failedJobs: diagnostics };
}

export async function githubDispatchWorkflow(input: {
  owner: string;
  repo: string;
  workflow: string;
  branch?: string;
  inputs?: Record<string, string>;
}) {
  const token = await getInstallationToken(input.owner, input.repo);
  const branch = input.branch || (await githubStatus(input.owner, input.repo)).default_branch;
  await github(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/workflows/${encodeURIComponent(input.workflow)}/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({ ref: branch, inputs: input.inputs || {} }),
    },
    token,
  );
  return { workflow: input.workflow, branch, dispatched: true };
}
