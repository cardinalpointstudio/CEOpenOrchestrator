/**
 * Main orchestrator with interactive TUI
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import chalk from "chalk";

import type { Phase, WorkflowState, Config, ReviewStatus } from "./types.js";
import { SESSION_NAME, WORKFLOW_DIR, SIGNALS_DIR, WINDOWS, VALID_PHASES } from "./types.js";
import { loadConfig } from "./config.js";
import {
  loadState,
  saveState,
  getSignals,
  determinePhase,
  getReviewStatus,
  createSignal,
  clearWorkflow,
  getInitialState,
  saveSessionToBranch,
  loadSessionFromBranch,
} from "./state.js";
import { addTimelineEvent, logPhaseChange } from "./timeline.js";
import {
  getCurrentBranch,
  getCommitCount,
  createFeatureBranch,
  commitChanges,
  createPullRequest,
  getFeatureNameFromPlan,
  createCheckpointCommit,
  isMainBranch,
  getRecentBranches,
  createBranchFromTemplate,
  switchBranch,
  renameBranch,
  deleteBranch,
  getCommitsAheadBehind,
} from "./git.js";
import { exportToJSON, exportToMarkdown } from "./export.js";
import { dispatchAllWorkers, dispatchReviewer } from "./workers.js";
import { getRecentErrors, formatErrorsForDisplay, hasErrors } from "./errors.js";

// ============================================================================
// UI Constants
// ============================================================================

const UI = {
  width: 70,
  headerColor: chalk.blue.bold,
  phaseColor: (phase: Phase): import("chalk").ChalkInstance => {
    const colors: Record<Phase, import("chalk").ChalkInstance> = {
      init: chalk.gray,
      planning: chalk.yellow,
      implementing: chalk.blue,
      reviewing: chalk.magenta,
      refining: chalk.yellow,
      compounding: chalk.cyan,
      complete: chalk.green,
    };
    return colors[phase] || chalk.white;
  },
};

// ============================================================================
// Display Functions
// ============================================================================

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

function showCursor(): void {
  process.stdout.write("\x1b[?25h");
}

function renderHeader(): void {
  console.log(chalk.blue("═".repeat(UI.width)));
  console.log(chalk.blue.bold("  ⚡ CEOpenOrchestrator".padEnd(UI.width - 1)));
  console.log(chalk.blue("═".repeat(UI.width)));
  console.log();
}

function renderGitInfo(state: WorkflowState): void {
  const branch = state.branchName || getCurrentBranch();
  const commits = state.commitCount || getCommitCount();
  const isOnMain = branch === "main" || branch === "master";

  console.log(`  ${chalk.bold("Branch:")} ${isOnMain ? chalk.gray(branch) : chalk.cyan(branch)}`);
  console.log(`  ${chalk.bold("Commits:")} ${commits > 0 ? chalk.green(commits) : chalk.gray(commits)}`);
  if (state.featureName) {
    console.log(`  ${chalk.bold("Feature:")} ${chalk.white(state.featureName)}`);
  }
  console.log();
}

function renderPhase(phase: Phase, iteration: number): void {
  const safePhase = phase || "init";
  const phaseLabel = safePhase.toUpperCase();
  const color = UI.phaseColor(safePhase);

  console.log(`  ${chalk.bold("Phase:")} ${color(phaseLabel)}`);
  console.log(`  ${chalk.dim(`Iteration: ${iteration}/3`)}`);
  console.log();
}

function renderSignals(signals: Record<string, boolean>, phase: Phase): void {
  console.log(`  ${chalk.bold("Progress:")}`);

  const coreSignals = [
    { key: "plan", label: "PM" },
    { key: "backend", label: "Backend" },
    { key: "frontend", label: "Frontend" },
    { key: "tests", label: "Tests" },
    { key: "review", label: "Review" },
    { key: "compound", label: "Compound" },
  ];

  let line = "    ";
  for (const sig of coreSignals) {
    const done = signals[sig.key];
    const icon = done ? chalk.green("✓") : chalk.gray("○");
    line += `${icon} ${sig.label}  `;
  }
  console.log(line);

  // Show refine signals if in refine phase
  if (phase === "refining" || signals["backend-refine"]) {
    console.log();
    console.log(`  ${chalk.dim("Refine:")}`);
    const refineSignals = [
      { key: "backend-refine", label: "Backend" },
      { key: "frontend-refine", label: "Frontend" },
      { key: "tests-refine", label: "Tests" },
    ];

    line = "    ";
    for (const sig of refineSignals) {
      const done = signals[sig.key];
      const icon = done ? chalk.green("✓") : chalk.gray("○");
      line += `${icon} ${sig.label}  `;
    }
    console.log(line);
  }

  console.log();
}

function renderReviewStatus(status: ReviewStatus): void {
  if (status === "PENDING") return;

  console.log(`  ${chalk.bold("Review:")}`);

  switch (status) {
    case "PASS":
      console.log(`    ${chalk.green("✓ PASS")} - Ready to compound`);
      break;
    case "PASS_WITH_WARNINGS":
      console.log(`    ${chalk.yellow("⚠ PASS_WITH_WARNINGS")} - Minor issues noted`);
      break;
    case "FAIL":
      console.log(`    ${chalk.red("✗ FAIL")} - Requires refinement`);
      break;
  }

  console.log();
}

function renderNextAction(phase: Phase, signals: Record<string, boolean>, config: Config): void {
  console.log(`  ${chalk.bold.yellow("▶ Next Action:")}`);

  const key = (k: string) => chalk.cyan.bold(`[${k.toUpperCase()}]`);

  switch (phase) {
    case "init":
      console.log(`    Go to Plan window and describe your feature`);
      console.log(`    ${chalk.dim(`(Ctrl+b ${WINDOWS.planner})`)}`);
      break;

    case "planning":
      if (signals.plan) {
        console.log(`    Plan complete! Press ${key(config.keybindings.dispatch_plan)} to dispatch workers`);
      } else {
        console.log(`    Wait for Planner to create PLAN.md, then approve`);
        console.log(`    Press ${key(config.keybindings.dispatch_plan)} when ready`);
      }
      break;

    case "implementing": {
      const implDone = signals.backend && signals.frontend && signals.tests;
      if (implDone) {
        console.log(`    All workers done! Press ${key(config.keybindings.dispatch_review)} to review`);
      } else {
        console.log(`    Workers implementing...`);
        console.log(`    ${chalk.dim(`Check windows ${WINDOWS.backend}-${WINDOWS.tests} for progress`)}`);
      }
      break;
    }

    case "reviewing": {
      const reviewStatus = getReviewStatus();
      if (reviewStatus === "PENDING") {
        console.log(`    Review in progress...`);
        console.log(`    ${chalk.dim(`Check window ${WINDOWS.reviewer} for progress`)}`);
      } else if (reviewStatus === "PASS" || reviewStatus === "PASS_WITH_WARNINGS") {
        console.log(`    ${chalk.green("Review passed!")} Press ${key(config.keybindings.dispatch_compound)} to compound`);
      } else {
        console.log(`    ${chalk.red("Review failed")} Press ${key(config.keybindings.dispatch_refine)} to fix issues`);
      }
      break;
    }

    case "refining": {
      const refineDone = signals["backend-refine"] && signals["frontend-refine"] && signals["tests-refine"];
      if (refineDone) {
        console.log(`    Refine complete! Press ${key(config.keybindings.dispatch_review)} to re-review`);
      } else {
        console.log(`    Workers fixing issues...`);
      }
      break;
    }

    case "compounding":
      if (signals.compound) {
        console.log(`    ${chalk.green("Compound complete!")} Press ${key(config.keybindings.create_pr)} to create PR`);
      } else {
        console.log(`    Documenting learnings...`);
      }
      break;

    case "complete":
      console.log(`    ${chalk.green("🎉 Workflow complete!")}`);
      console.log(`    Press ${key(config.keybindings.quit)} to exit`);
      break;
  }

  console.log();
}

function renderMenu(config: Config): void {
  console.log(`  ${chalk.dim("─".repeat(UI.width - 4))}`);
  console.log(`  ${chalk.bold("Commands:")}`);

  const kb = config.keybindings;
  const items = [
    [`${kb.dispatch_plan}`, "Plan → Workers", `${kb.dispatch_review}`, "Review"],
    [`${kb.dispatch_refine}`, "Refine", `${kb.dispatch_compound}`, "Compound"],
    [`${kb.create_pr}`, "Push & PR", `${kb.commit_checkpoint}`, "Commit"],
    [`${kb.refresh_status}`, "Refresh", `${kb.new_feature}`, "New Feature"],
    [`${kb.open_web}`, "Web Dashboard", `${kb.quit}`, "Quit"],
  ];

  for (const [key1, desc1, key2, desc2] of items) {
    const line1 = key1 ? `${chalk.cyan(`[${key1.toUpperCase()}]`)} ${desc1}` : "";
    const line2 = key2 ? `${chalk.cyan(`[${key2.toUpperCase()}]`)} ${desc2}` : "";
    console.log(`    ${line1.padEnd(25)} ${line2}`);
  }

  console.log();
  console.log(`  ${chalk.dim(`Windows: Ctrl+b then 1=Orch 2=PM 3=Back 4=Front 5=Tests 6=Review 7=Dashboard`)}`);
}

function renderBranchManagement(state: WorkflowState): void {
  const branch = state.branchName || getCurrentBranch();
  const isMain = isMainBranch();
  
  console.log();
  console.log(`  ${chalk.cyan("─".repeat(UI.width - 4))}`);
  console.log(`  ${chalk.bold("Branch Management:")}`);
  console.log();
  
  if (isMain) {
    // Yellow warning for main branch
    console.log(chalk.yellow(`  ⚠️  WARNING: Working on ${branch} branch`));
    console.log(chalk.dim(`     Compound workflow works best with feature branches`));
    console.log();
    console.log(`  Press ${chalk.cyan("[B]")} to create feature branch`);
  } else {
    console.log(`  Current: ${chalk.green(branch)}`);
    const { ahead, behind } = getCommitsAheadBehind();
    if (ahead > 0 || behind > 0) {
      console.log(`  Status: ${chalk.green("+" + ahead)} / ${chalk.red("-" + behind)} commits vs main`);
    }
    console.log();
    console.log(`  Press ${chalk.cyan("[B]")} for branch options`);
  }
  console.log();
}

function renderSessionManagement(state: WorkflowState): void {
  console.log(`  ${chalk.cyan("─".repeat(UI.width - 4))}`);
  console.log(`  ${chalk.bold("Session Management:")}`);
  console.log();
  console.log(`  Iteration: ${state.iteration}/3  |  Commits: ${state.commitCount ?? 0}`);
  console.log();
  console.log(`  ${chalk.cyan("[E]")} Export Log  ${chalk.cyan("[X]")} Clear & Restart`);
  console.log();
}

function render(state: WorkflowState, config: Config): void {
  clearScreen();
  renderHeader();
  renderGitInfo(state);
  renderPhase(state.phase, state.iteration);
  renderSignals(state.signals, state.phase);

  const reviewStatus = getReviewStatus();
  if (reviewStatus !== "PENDING") {
    renderReviewStatus(reviewStatus);
  }

  // Show recent errors if any
  if (hasErrors()) {
    const errors = getRecentErrors(3);
    console.log(formatErrorsForDisplay(errors));
  }

  renderNextAction(state.phase, state.signals, config);
  renderMenu(config);
  renderBranchManagement(state);
  renderSessionManagement(state);
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handlePlanApproved(config: Config, state: WorkflowState): Promise<void> {
  const planPath = join(process.cwd(), WORKFLOW_DIR, "PLAN.md");

  if (!existsSync(planPath)) {
    console.log(chalk.yellow("\n⚠️  No PLAN.md found. Create a plan first.\n"));
    await sleep(2000);
    return;
  }

  // Get feature name
  const featureName = getFeatureNameFromPlan();
  state.featureName = featureName;

  // Create feature branch
  console.log(chalk.cyan("\n📁 Creating feature branch..."));
  const branchResult = createFeatureBranch(featureName, config);

  if (!branchResult.success) {
    console.log(chalk.red(`\n✗ Failed to create branch: ${branchResult.error}\n`));
    await sleep(2000);
    return;
  }

  state.branchName = branchResult.branch;
  console.log(chalk.green(`  ✓ Branch: ${branchResult.branch}`));

  // Commit planning docs
  if (config.git.auto_commit) {
    console.log(chalk.dim("  Committing plan..."));
    const commitResult = commitChanges("docs", featureName, "plan");
    if (commitResult.success) {
      state.commitCount = getCommitCount();
      console.log(chalk.green(`  ✓ Committed: docs(plan): ${featureName}`));
    }
  }

  // Create plan signal
  createSignal("plan");
  addTimelineEvent("session_start", `Session started: ${featureName}`);

  // Dispatch workers
  console.log(chalk.cyan("\n🚀 Dispatching implementation workers..."));
  dispatchAllWorkers(config);

  // Update state
  state.phase = "implementing";
  state.signals = getSignals();
  saveState(state);

  await sleep(1000);
}

async function handleDispatchReview(config: Config, state: WorkflowState): Promise<void> {
  console.log(chalk.cyan("\n🔍 Dispatching review..."));

  // Commit implementation if auto-commit enabled
  if (config.git.auto_commit && state.phase === "implementing") {
    const featureName = state.featureName || "CE workflow";
    console.log(chalk.dim("  Committing implementation..."));
    const commitResult = commitChanges("feat", featureName);
    if (commitResult.success) {
      state.commitCount = getCommitCount();
      console.log(chalk.green(`  ✓ Committed: feat: ${featureName}`));
    }
  }

  dispatchReviewer(config);

  logPhaseChange("reviewing");
  state.phase = "reviewing";
  saveState(state);

  await sleep(500);
}

async function handleDispatchRefine(config: Config, state: WorkflowState): Promise<void> {
  const reviewStatus = getReviewStatus();

  if (reviewStatus !== "FAIL") {
    console.log(chalk.yellow("\n⚠️  Review hasn't failed - no need to refine\n"));
    await sleep(1500);
    return;
  }

  if (state.iteration >= 3) {
    console.log(chalk.red("\n⚠️  Max iterations reached. Manual intervention required.\n"));
    await sleep(2000);
    return;
  }

  console.log(chalk.cyan("\n🔧 Dispatching refine workers..."));
  state.iteration++;
  dispatchAllWorkers(config, true);

  logPhaseChange("refining");
  state.phase = "refining";
  saveState(state);

  await sleep(1000);
}

async function handleDispatchCompound(config: Config, state: WorkflowState): Promise<void> {
  const reviewStatus = getReviewStatus();

  if (reviewStatus !== "PASS" && reviewStatus !== "PASS_WITH_WARNINGS") {
    console.log(chalk.red("\n⚠️  Review hasn't passed - cannot compound\n"));
    await sleep(1500);
    return;
  }

  console.log(chalk.cyan("\n📚 Dispatching compound..."));

  // TODO: Implement compound worker dispatch
  // For now, just create the signal
  createSignal("compound");

  logPhaseChange("compounding");
  state.phase = "compounding";
  saveState(state);

  await sleep(500);
}

async function handleCreatePR(config: Config, state: WorkflowState): Promise<void> {
  if (!state.signals.compound) {
    console.log(chalk.red("\n⚠️  Compound not complete - cannot create PR\n"));
    await sleep(1500);
    return;
  }

  console.log(chalk.cyan("\n📤 Creating pull request..."));

  const featureName = state.featureName || "CE workflow";
  const result = createPullRequest(featureName, state.commitCount);

  if (result.success) {
    console.log(chalk.green(`\n✓ PR created: ${result.prUrl}\n`));
    createSignal("pr");
    state.phase = "complete";
    saveState(state);
  } else {
    console.log(chalk.red(`\n✗ Failed: ${result.error}\n`));
  }

  await sleep(2000);
}

async function handleManualCommit(config: Config, state: WorkflowState): Promise<void> {
  if (state.phase === "init") {
    console.log(chalk.yellow("\n⚠️  Nothing to commit yet - start planning first\n"));
    await sleep(1500);
    return;
  }

  const commitType =
    state.phase === "planning"
      ? "docs"
      : state.phase === "implementing"
      ? "feat"
      : state.phase === "refining"
      ? "fix"
      : "chore";

  const featureName = state.featureName || "CE workflow checkpoint";
  const result = commitChanges(commitType, featureName);

  if (result.success) {
    state.commitCount = getCommitCount();
    console.log(chalk.green(`\n✓ Committed: ${commitType}: ${featureName}\n`));
  } else if (result.error) {
    console.log(chalk.yellow(`\n⚠️  Nothing to commit (no changes)\n`));
  }

  saveState(state);
  await sleep(1500);
}

async function handleNewFeature(): Promise<void> {
  console.log(chalk.yellow("\n🔄 Clear workflow and start new feature? [y/N]"));

  // Wait for user confirmation
  const response = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim().toLowerCase());
    });
  });

  if (response === "y") {
    console.log(chalk.cyan("\n🧹 Clearing workflow..."));
    clearWorkflow();
    console.log(chalk.green("\n✓ Workflow cleared. Go to Plan window to start.\n"));
    await sleep(1000);
  } else {
    console.log(chalk.dim("\nCancelled\n"));
    await sleep(500);
  }
}

async function handleBranchManagement(config: Config, state: WorkflowState): Promise<void> {
  const isMain = isMainBranch();
  
  if (isMain) {
    console.log(chalk.yellow("\n⚠️  You are on main branch"));
    console.log(chalk.dim("   Compound workflow works best with feature branches.\n"));
    console.log("Options:");
    console.log("  [1] Create feature branch (recommended)");
    console.log("  [2] Continue on main anyway");
    console.log("  [3] Cancel\n");
    
    // Wait for user input
    const response = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });
    
    switch (response) {
      case "1":
        await createNewBranch();
        break;
      case "2":
        console.log(chalk.yellow("\n  Continuing on main branch...\n"));
        break;
      default:
        console.log(chalk.dim("\n  Cancelled\n"));
    }
  } else {
    console.log(chalk.cyan("\n📁 Branch Management\n"));
    console.log("Options:");
    console.log("  [1] Switch to existing branch");
    console.log("  [2] Create new branch");
    console.log("  [3] Rename current branch");
    console.log("  [4] Delete branch");
    console.log("  [5] Cancel\n");
    
    const response = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });
    
    switch (response) {
      case "1":
        await switchToBranch(config);
        break;
      case "2":
        await createNewBranch();
        break;
      case "3":
        await handleRenameBranch(state);
        break;
      case "4":
        await handleDeleteBranch();
        break;
      default:
        console.log(chalk.dim("\n  Cancelled\n"));
    }
  }
  
  await sleep(500);
}

async function createNewBranch(): Promise<void> {
  console.log(chalk.cyan("\n📁 Create New Branch\n"));
  console.log("Templates:");
  console.log("  [1] Compound Feature - compound/YYYYMMDD-name (default)");
  console.log("  [2] Feature Branch   - feature/name");
  console.log("  [3] Hotfix           - hotfix/name");
  console.log("  [4] Custom           - you specify\n");
  
  const templateResponse = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
  
  let template: string;
  switch (templateResponse) {
    case "2":
      template = "feature";
      break;
    case "3":
      template = "hotfix";
      break;
    case "4":
      template = "custom";
      break;
    default:
      template = "compound";
  }
  
  console.log(chalk.dim("\nEnter branch name (without prefix):"));
  const name = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
  
  if (!name) {
    console.log(chalk.red("\n✗ Branch name required\n"));
    return;
  }
  
  const result = createBranchFromTemplate(template, name);
  
  if (result.success && result.branch) {
    console.log(chalk.green(`\n✓ Created and switched to: ${result.branch}\n`));
  } else {
    console.log(chalk.red(`\n✗ Failed: ${result.error}\n`));
  }
}

async function switchToBranch(config: Config): Promise<void> {
  const branches = getRecentBranches(10);
  
  console.log(chalk.cyan("\n📁 Switch Branch\n"));
  console.log("Recent branches:");
  
  branches.forEach((branch, i) => {
    const current = branch === getCurrentBranch() ? " (current)" : "";
    console.log(`  [${i + 1}] ${branch}${current}`);
  });
  
  console.log("\nEnter number or type branch name:");
  
  const response = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });

  const index = Number.parseInt(response) - 1;
  const branchName = branches[index] || response;

  if (!branchName) {
    console.log(chalk.red("\n✗ Invalid branch\n"));
    return;
  }
  
  console.log(chalk.dim("\n  Saving current session..."));
  const currentBranch = getCurrentBranch();
  saveSessionToBranch(currentBranch);
  addTimelineEvent("session_resume", `Saved session for ${currentBranch}`);

  console.log(chalk.dim("  Switching branch..."));
  const result = switchBranch(branchName);

  if (result.success) {
    console.log(chalk.green(`\n✓ Switched to: ${branchName}`));

    // Try to load saved session for the branch
    const loadedState = loadSessionFromBranch(branchName);
    if (loadedState) {
      console.log(chalk.green(`  ✓ Session restored for ${branchName}`));
      addTimelineEvent("session_resume", `Loaded session for ${branchName}`);

      // Prompt to restart workers if needed
      if (loadedState.phase === "implementing" || loadedState.phase === "refining") {
        console.log(chalk.yellow("\n⚠️  Workers were active in this session"));
        console.log("   [R] Restart workers  [Enter] Continue\n");

        const restartResponse = await new Promise<string>((resolve) => {
          process.stdin.once("data", (data) => {
            resolve(data.toString().trim().toLowerCase());
          });
        });

        if (restartResponse === "r") {
          console.log(chalk.cyan("\n🚀 Restarting workers..."));
          const isRefine = loadedState.phase === "refining";
          dispatchAllWorkers(config, isRefine);
          addTimelineEvent("worker_dispatch", `Restarted ${isRefine ? "refine" : "implementation"} workers`);
          await sleep(1000);
        }
      }
    } else {
      console.log(chalk.dim(`  ℹ Starting fresh session on ${branchName}`));
    }
    console.log();
  } else {
    console.log(chalk.red(`\n✗ Failed: ${result.error}\n`));
  }
}

async function handleRenameBranch(state: WorkflowState): Promise<void> {
  const current = state.branchName || getCurrentBranch();
  
  console.log(chalk.cyan("\n📁 Rename Branch\n"));
  console.log(`Current: ${current}`);
  console.log("Enter new name (without prefix):\n");
  
  const newName = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
  
  if (!newName) {
    console.log(chalk.red("\n✗ New name required\n"));
    return;
  }
  
  const result = renameBranch(current, newName);
  
  if (result.success) {
    console.log(chalk.green(`\n✓ Renamed to: ${newName}\n`));
  } else {
    console.log(chalk.red(`\n✗ Failed: ${result.error}\n`));
  }
}

async function handleDeleteBranch(): Promise<void> {
  const branches = getRecentBranches(10).filter(b => b !== getCurrentBranch());
  
  console.log(chalk.cyan("\n📁 Delete Branch\n"));
  console.log("Available branches:");
  
  branches.forEach((branch, i) => {
    console.log(`  [${i + 1}] ${branch}`);
  });

  console.log("\nEnter number or type branch name:");

  const response = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });

  const index = Number.parseInt(response) - 1;
  const branchName = branches[index] || response;

  if (!branchName || branchName === getCurrentBranch()) {
    console.log(chalk.red("\n✗ Cannot delete current branch\n"));
    return;
  } 
  
  console.log(chalk.yellow(`\n⚠️  Are you sure you want to delete ${branchName}? [y/N]`));
  
  const confirm = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim().toLowerCase());
    });
  });
  
  if (confirm !== "y") {
    console.log(chalk.dim("\n  Cancelled\n"));
    return;
  }
  
  const result = deleteBranch(branchName);
  
  if (result.success) {
    console.log(chalk.green(`\n✓ Deleted: ${branchName}\n`));
  } else {
    console.log(chalk.red(`\n✗ Failed: ${result.error}\n`));
  }
}

async function handleExportSession(): Promise<void> {
  console.log(chalk.cyan("\n📤 Export Session\n"));
  console.log("Options:");
  console.log("  [1] Export as JSON");
  console.log("  [2] Export as Markdown");
  console.log("  [3] Export both");
  console.log("  [4] Cancel\n");
  
  const response = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
  
  switch (response) {
    case "1": {
      const filepath = exportToJSON();
      console.log(chalk.green(`\n✓ Exported to: ${filepath}\n`));
      break;
    }
    case "2": {
      const filepath = exportToMarkdown();
      console.log(chalk.green(`\n✓ Exported to: ${filepath}\n`));
      break;
    }
    case "3": {
      const jsonPath = exportToJSON();
      const mdPath = exportToMarkdown();
      console.log(chalk.green(`\n✓ Exported to:`));
      console.log(`  - ${jsonPath}`);
      console.log(`  - ${mdPath}\n`);
      break;
    }
    default:
      console.log(chalk.dim("\n  Cancelled\n"));
  }
  
  await sleep(500);
}

async function handleClearSession(): Promise<void> {
  console.log(chalk.yellow("\n⚠️  Clear Session"));
  console.log(chalk.dim("   This will clear all workflow state and signals."));
  console.log(chalk.dim("   Commits will NOT be affected.\n"));
  console.log("Are you sure? [y/N]\n");
  
  const confirm = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim().toLowerCase());
    });
  });
  
  if (confirm !== "y") {
    console.log(chalk.dim("\n  Cancelled\n"));
    return;
  }
  
  console.log(chalk.dim("\n  Clearing session..."));
  clearWorkflow();
  console.log(chalk.green("\n✓ Session cleared\n"));
  
  await sleep(1000);
}

async function handleOpenWebDashboard(config: Config): Promise<void> {
  const port = config.dashboard.web_port || 8080;
  const url = `http://localhost:${port}`;
  
  console.log(chalk.cyan(`\n🌐 Opening web dashboard at ${url}...`));
  
  // Check if server is already running
  let serverRunning = false;
  try {
    execSync(`curl -s http://localhost:${port}/api/state`, { stdio: "ignore" });
    serverRunning = true;
    console.log(chalk.dim("  Web server already running"));
  } catch {
    // Server not running, start it
    console.log(chalk.dim("  Starting web server..."));
    try {
      // Start web server in background
      const { spawn } = await import("node:child_process");
      const serverProcess = spawn("ce-orchestrate", ["web", "--port", String(port)], {
        detached: true,
        stdio: "ignore",
      });
      serverProcess.unref();
      
      // Wait for server to be ready
      console.log(chalk.dim("  Waiting for server to start..."));
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        try {
          execSync(`curl -s http://localhost:${port}/api/state`, { stdio: "ignore" });
          console.log(chalk.green("  ✓ Web server started"));
          serverRunning = true;
          break;
        } catch {
          // Still starting
        }
      }
    } catch (error) {
      console.log(chalk.red(`\n✗ Failed to start web server`));
      console.log(chalk.dim(`   You can start it manually: ce-orchestrate web --port ${port}\n`));
      await sleep(2000);
      return;
    }
  }
  
  if (!serverRunning) {
    console.log(chalk.red(`\n✗ Web server failed to start`));
    await sleep(1500);
    return;
  }
  
  // Try to open browser
  try {
    const platform = process.platform;
    let command: string;
    
    if (platform === "darwin") {
      command = `open "${url}"`;
    } else if (platform === "win32") {
      command = `start "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }
    
    execSync(command, { stdio: "ignore" });
    console.log(chalk.green("✓ Browser opened\n"));
  } catch {
    console.log(chalk.yellow(`⚠️  Could not open browser automatically`));
    console.log(chalk.dim(`   Please open: ${url}\n`));
  }
  
  await sleep(1500);
}

// ============================================================================
// Main Loop
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startOrchestrator(): Promise<void> {
  // Check if we're in a workflow directory
  const workflowDir = join(process.cwd(), WORKFLOW_DIR);
  if (!existsSync(workflowDir)) {
    console.log(chalk.red("Error: No .workflow/ directory found."));
    console.log("Run 'ce-orchestrate init' first.");
    process.exit(1);
  }

  const config = loadConfig();
  let state = loadState();

  // Set up terminal
  hideCursor();
  process.on("exit", showCursor);
  process.on("SIGINT", () => {
    showCursor();
    console.log("\n");
    process.exit(0);
  });

  // Set up keyboard input
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Initial render
  render(state, config);

  // Handle keyboard input
  process.stdin.on("keypress", async (str, key) => {
    if (key.ctrl && key.name === "c") {
      showCursor();
      console.log("\n");
      process.exit(0);
    }

    const char = str?.toLowerCase();
    const kb = config.keybindings;

    // Update state from signals
    state = loadState();
    state.signals = getSignals();

    switch (char) {
      case kb.dispatch_plan:
        if (state.phase === "planning" || !state.signals.plan) {
          await handlePlanApproved(config, state);
        }
        break;

      case kb.dispatch_review:
        if (state.phase === "implementing" || state.phase === "refining") {
          await handleDispatchReview(config, state);
        }
        break;

      case kb.dispatch_refine:
        await handleDispatchRefine(config, state);
        break;

      case kb.dispatch_compound:
        await handleDispatchCompound(config, state);
        break;

      case kb.create_pr:
        await handleCreatePR(config, state);
        break;

      case kb.commit_checkpoint:
        await handleManualCommit(config, state);
        break;

      case kb.refresh_status:
        state = loadState();
        state.signals = getSignals();
        state.commitCount = getCommitCount();
        break;

      case kb.new_feature:
        await handleNewFeature();
        state = loadState();
        break;

      case kb.open_web:
        await handleOpenWebDashboard(config);
        break;

      case "b":
        await handleBranchManagement(config, state);
        break;

      case "e":
        await handleExportSession();
        break;

      case "x":
        await handleClearSession();
        break;

      case kb.quit:
        showCursor();
        console.log("\n");
        process.exit(0);
        break;
    }

    // Re-render
    render(state, config);
  });

  // Keep process alive
  await new Promise(() => {});
}
