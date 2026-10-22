import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLinkedWorktreeGitFile } from "../common/file-filter-service";
import { createScanOptions, scanDirectory } from "../common/file-scan-utils";

// As in file-scan-utils.test.ts: the path heuristics would reject the temp root itself, so only
// traversal is exercised.
const scanOpts = createScanOptions({
  enableSystemPathFilter: false,
  enableDevPathFilter: false,
  enableCachePathFilter: false,
  enablePhotosLibraryFilter: false,
});

describe("isLinkedWorktreeGitFile", () => {
  it("recognizes a linked worktree of a normal and of a bare repository", () => {
    expect(isLinkedWorktreeGitFile("gitdir: /Users/a/repo/.git/worktrees/feature-x\n")).toBe(true);
    expect(isLinkedWorktreeGitFile("gitdir: /Users/a/repo.git/worktrees/feature-x")).toBe(true);
    expect(isLinkedWorktreeGitFile("gitdir: C:\\code\\repo\\.git\\worktrees\\fix\r\n")).toBe(true);
  });

  it("leaves submodules and anything else alone", () => {
    expect(isLinkedWorktreeGitFile("gitdir: ../.git/modules/vendor-lib\n")).toBe(false);
    expect(isLinkedWorktreeGitFile("gitdir: /Users/a/worktrees/repo/.git\n")).toBe(false);
    expect(isLinkedWorktreeGitFile("[core]\n\tbare = false\n")).toBe(false);
    expect(isLinkedWorktreeGitFile("")).toBe(false);
  });
});

describe("scanDirectory and linked worktrees", () => {
  let root = "";

  beforeEach(async () => {
    // Under the package: the macOS temp folder sits under /var, which no option lets through.
    root = await realpath(await mkdtemp(path.join(process.cwd(), "scan-wt-")));
    await mkdir(path.join(root, "repo", ".git"), { recursive: true });
    await writeFile(path.join(root, "repo", "main.txt"), "main");
    await mkdir(path.join(root, "repo", "vendor"), { recursive: true });
    await writeFile(path.join(root, "repo", "vendor", ".git"), "gitdir: ../.git/modules/vendor\n");
    await writeFile(path.join(root, "repo", "vendor", "vendored.txt"), "vendored");
    await mkdir(path.join(root, "repo-feature"), { recursive: true });
    await writeFile(
      path.join(root, "repo-feature", ".git"),
      `gitdir: ${path.join(root, "repo", ".git", "worktrees", "repo-feature")}\n`,
    );
    await writeFile(path.join(root, "repo-feature", "main.txt"), "worktree copy");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("skips a linked worktree below the scan root but keeps the repository and its submodule", async () => {
    const names = (await scanDirectory(root, scanOpts)).map((file) => path.relative(root, file.path)).sort();

    expect(names).toEqual([path.join("repo", "main.txt"), path.join("repo", "vendor", "vendored.txt")]);
  });

  it("keeps a linked worktree the user picked as the scan root", async () => {
    const files = await scanDirectory(path.join(root, "repo-feature"), scanOpts);

    expect(files.map((file) => file.name)).toEqual(["main.txt"]);
  });
});
