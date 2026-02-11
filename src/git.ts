/**
 * Git operations for CEOpenOrchestrator
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types.js";

export function getCurrentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function getCommitCount(): number {
  try {
    const mainBranch = execSync("git rev-parse --verify main 2>/dev/null || echo master", {
      encoding: "utf-8",
    }).trim();
    const count = execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, {
      encoding: "utf-8",
    }).trim();
    return Number.parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

export function hasUncommittedChanges(): boolean {
  try {
    const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function createFeatureBranch(featureName: string, config: Config): {
  branch: string;
  success: boolean;
  error?: string;
} {
  try {
    const currentBranch = getCurrentBranch();

    // Only create new branch if on main/master
    if (currentBranch !== "main" && currentBranch !== "master") {
      return { branch: currentBranch, success: true };
    }

    const slug = generateSlug(featureName);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const branch = `${config.git.branch_prefix}${date}-${slug}`;

    execSync(`git checkout -b ${branch}`, { stdio: "ignore" });
    return { branch, success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { branch: "", success: false, error };
  }
}

export function commitChanges(
  type: string,
  message: string,
  scope?: string
): { success: boolean; error?: string } {
  try {
    // Stage all changes
    execSync("git add -A", { stdio: "ignore" });
    
    // Exclude .workflow/ from commits
    try {
      execSync("git reset HEAD -- .workflow/", { stdio: "ignore" });
    } catch {
      // Ignore if .workflow/ not staged
    }

    // Check if there are staged changes
    const staged = execSync("git diff --cached --name-only", { encoding: "utf-8" }).trim();
    if (!staged) {
      return { success: true }; // Nothing to commit is fine
    }

    const scopePart = scope ? `(${scope})` : "";
    const fullMessage = `${type}${scopePart}: ${message}\n\n🤖 Generated with CEOpenOrchestrator`;

    // Write message to temp file for reliability
    const tmpFile = "/tmp/ce-commit-msg.txt";
    writeFileSync(tmpFile, fullMessage);
    
    execSync(`git commit -F ${tmpFile}`, { stdio: "ignore" });
    unlinkSync(tmpFile);
    
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function pushBranch(branch: string): { success: boolean; error?: string } {
  try {
    execSync(`git push -u origin ${branch}`, { stdio: "ignore" });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function createPullRequest(
  featureName: string,
  commitCount: number
): { success: boolean; prUrl?: string; error?: string } {
  try {
    const currentBranch = getCurrentBranch();

    // Push branch first
    const pushResult = pushBranch(currentBranch);
    if (!pushResult.success) {
      return { success: false, error: pushResult.error };
    }

    // Create PR with rich description
    const prBody = `## Summary
Implemented **${featureName}** using CEOpenOrchestrator workflow.

## Commits
This PR contains ${commitCount} commit(s) from the compound workflow:
- Planning and design
- Implementation (backend, frontend, tests in parallel)
- Review feedback fixes (if any)

## Test Plan
- [ ] Manual testing completed
- [ ] Type checking passes
- [ ] All tests pass

🤖 Generated with CEOpenOrchestrator`;

    const prOutput = execSync(
      `gh pr create --title "feat: ${featureName}" --body "${prBody.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8" }
    ).trim();

    // Extract PR URL from output
    const urlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+/);
    const prUrl = urlMatch ? urlMatch[0] : prOutput;

    return { success: true, prUrl };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function createCheckpointCommit(): { success: boolean; error?: string } {
  try {
    if (!hasUncommittedChanges()) {
      return { success: true }; // Nothing to commit
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const message = `CHECKPOINT: Before compound session ${timestamp}`;

    execSync("git add -A", { stdio: "ignore" });
    execSync(`git commit -m "${message}" --quiet`, { stdio: "ignore" });

    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function getFeatureNameFromPlan(): string {
  const planPath = join(process.cwd(), ".workflow", "PLAN.md");
  
  try {
    if (!existsSync(planPath)) return "CE workflow feature";
    
    const content = readFileSync(planPath, "utf-8");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1];
    }
  } catch {
    // Ignore read errors
  }
  
  return "CE workflow feature";
}

export function getRecentCommits(limit: number = 10): string[] {
  try {
    const output = execSync(`git log --oneline -${limit}`, { encoding: "utf-8" });
    return output.trim().split("\n").filter(line => line.length > 0);
  } catch {
    return [];
  }
}

export function getRecentBranches(limit: number = 5): string[] {
  try {
    const output = execSync("git branch --sort=-committerdate", { encoding: "utf-8" });
    return output
      .trim()
      .split("\n")
      .map(b => b.replace(/^\*\s*/, "").trim())
      .filter(b => b.length > 0)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function createBranchFromTemplate(
  template: string,
  name: string,
  date: string = new Date().toISOString().slice(0, 10).replace(/-/g, "")
): { success: boolean; branch?: string; error?: string } {
  try {
    let branchName: string;
    
    switch (template) {
      case "compound":
        branchName = `compound/${date}-${name}`;
        break;
      case "feature":
        branchName = `feature/${name}`;
        break;
      case "hotfix":
        branchName = `hotfix/${name}`;
        break;
      default:
        branchName = name;
    }
    
    execSync(`git checkout -b ${branchName}`, { stdio: "ignore" });
    
    return { success: true, branch: branchName };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function switchBranch(branch: string): { success: boolean; error?: string } {
  try {
    execSync(`git checkout ${branch}`, { stdio: "ignore" });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function renameBranch(
  oldName: string,
  newName: string
): { success: boolean; error?: string } {
  try {
    execSync(`git branch -m ${oldName} ${newName}`, { stdio: "ignore" });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function deleteBranch(branch: string): { success: boolean; error?: string } {
  try {
    execSync(`git branch -D ${branch}`, { stdio: "ignore" });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

export function isMainBranch(): boolean {
  const branch = getCurrentBranch();
  return branch === "main" || branch === "master";
}

export function getCommitsAheadBehind(): { ahead: number; behind: number } {
  try {
    const mainBranch = "main";
    const output = execSync(`git rev-list --left-right --count ${mainBranch}...HEAD`, {
      encoding: "utf-8",
    }).trim();
    const [behind, ahead] = output.split("\t").map(n => parseInt(n, 10));
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export function validateGitSetup(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if in git repo
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore" });
  } catch {
    errors.push("Not in a git repository");
    return { valid: false, errors };
  }

  // Check for remote
  try {
    const remotes = execSync("git remote", { encoding: "utf-8" }).trim();
    if (!remotes) {
      errors.push("No git remote configured");
    }
  } catch {
    errors.push("Could not check git remotes");
  }

  // Check for GitHub CLI (optional)
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    errors.push("GitHub CLI (gh) not installed - PR creation will not work");
  }

  return { valid: errors.length === 0, errors };
}
