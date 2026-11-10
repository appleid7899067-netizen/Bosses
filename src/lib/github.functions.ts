import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  githubActions,
  githubCreateBranch,
  githubCreateIssue,
  githubCreatePullRequest,
  githubDispatchWorkflow,
  githubGetFile,
  githubStatus,
  githubWriteFile,
} from "./github-app.server";

function assertGitHubMutationsEnabled() {
  if (process.env.GITHUB_MUTATIONS_ENABLED !== "true") {
    throw new Error("GitHub mutations are disabled. Enable GITHUB_MUTATIONS_ENABLED explicitly.");
  }
}

const repoSchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
});

export const getGitHubStatus = createServerFn({ method: "GET" })
  .validator(repoSchema)
  .handler(async ({ data }) => githubStatus(data.owner, data.repo));

export const readGitHubFile = createServerFn({ method: "GET" })
  .validator(
    repoSchema.extend({
      path: z.string().min(1).max(500),
      ref: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => githubGetFile(data));

export const writeGitHubFile = createServerFn({ method: "POST" })
  .validator(
    repoSchema.extend({
      path: z.string().min(1).max(500),
      content: z.string().max(2_000_000),
      message: z.string().min(1).max(200),
      sha: z.string().optional(),
      branch: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => { assertGitHubMutationsEnabled(); return githubWriteFile(data); });

export const createGitHubBranch = createServerFn({ method: "POST" })
  .validator(
    repoSchema.extend({
      branch: z.string().min(1).max(200),
      from: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => { assertGitHubMutationsEnabled(); return githubCreateBranch(data); });

export const createGitHubPullRequest = createServerFn({ method: "POST" })
  .validator(
    repoSchema.extend({
      head: z.string().min(1).max(200),
      base: z.string().max(200).optional(),
      title: z.string().min(1).max(300),
      body: z.string().max(20_000).optional(),
    }),
  )
  .handler(async ({ data }) => { assertGitHubMutationsEnabled(); return githubCreatePullRequest(data); });

export const createGitHubIssue = createServerFn({ method: "POST" })
  .validator(
    repoSchema.extend({
      title: z.string().min(1).max(300),
      body: z.string().max(20_000).optional(),
    }),
  )
  .handler(async ({ data }) => { assertGitHubMutationsEnabled(); return githubCreateIssue(data); });

export const getGitHubActions = createServerFn({ method: "GET" })
  .validator(repoSchema.extend({ branch: z.string().max(200).optional() }))
  .handler(async ({ data }) => githubActions(data));

export const dispatchGitHubWorkflow = createServerFn({ method: "POST" })
  .validator(
    repoSchema.extend({
      workflow: z.string().min(1).max(300),
      branch: z.string().max(200).optional(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
  )
  .handler(async ({ data }) => { assertGitHubMutationsEnabled(); return githubDispatchWorkflow(data); });
