/**
 * Terminal Project Dashboard - live project status monitor
 * Runs in window 7, polls filesystem every 2 seconds
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { loadState, getSignals, determinePhase } from "./state.js";
import { getCurrentBranch, getCommitCount, getCommitsAheadBehind } from "./git.js";
import { getReviewStatus } from "./state.js";
import { loadConfig } from "./config.js";
import { loadTimeline } from "./timeline.js";
import { listBranchSessions } from "./state.js";
import type { Phase, WorkflowState } from "./types.js";
import { WORKFLOW_DIR, SIGNALS_DIR } from "./types.js";

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function renderHeader(): void {
  console.log(chalk.cyan("═".repeat(60)));
  console.log(chalk.cyan.bold("  📊 Project Dashboard".padEnd(59)));
  console.log(chalk.cyan("═".repeat(60)));
  console.log();
}

function renderState(state: WorkflowState): void {
  const branch = state.branchName || getCurrentBranch();
  const commits = state.commitCount || getCommitCount();
  const phase = state.phase;
  const branchStatus = getCommitsAheadBehind();

  console.log(`  Branch: ${chalk.green(branch)}`);
  console.log(`  Commits: ${commits > 0 ? chalk.yellow(commits) : chalk.gray(commits)} ${chalk.dim(`(+${branchStatus.ahead}/-${branchStatus.behind} vs main)`)}`);
  console.log(`  Phase: ${chalk.cyan(phase.toUpperCase())}`);
  console.log(`  Iteration: ${state.iteration}/3`);
  if (state.featureName) {
    console.log(`  Feature: ${chalk.white(state.featureName)}`);
  }
  if (state.lastUpdated) {
    const lastActive = new Date(state.lastUpdated);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - lastActive.getTime()) / 60000);
    let timeStr: string;
    if (diffMinutes < 1) {
      timeStr = "Just now";
    } else if (diffMinutes < 60) {
      timeStr = `${diffMinutes}m ago`;
    } else if (diffMinutes < 1440) {
      timeStr = `${Math.floor(diffMinutes / 60)}h ago`;
    } else {
      timeStr = lastActive.toLocaleDateString();
    }
    console.log(`  Last Activity: ${chalk.dim(timeStr)}`);
  }
  console.log();
}

function renderSignals(signals: Record<string, boolean>): void {
  console.log(chalk.bold("  Signals:"));
  console.log();
  
  const signalList = [
    { key: "plan", label: "PM" },
    { key: "backend", label: "Backend" },
    { key: "frontend", label: "Frontend" },
    { key: "tests", label: "Tests" },
    { key: "review", label: "Review" },
    { key: "compound", label: "Compound" },
  ];
  
  for (const sig of signalList) {
    const done = signals[sig.key];
    const icon = done ? chalk.green("✓") : chalk.gray("○");
    console.log(`    ${icon} ${sig.label}`);
  }
  
  // Show refine signals if any exist
  const refineSignals = ["backend-refine", "frontend-refine", "tests-refine"];
  const hasRefines = refineSignals.some(s => signals[s]);
  
  if (hasRefines) {
    console.log();
    console.log(chalk.dim("  Refine:"));
    for (const sig of refineSignals) {
      const done = signals[sig];
      const icon = done ? chalk.green("✓") : chalk.gray("○");
      const name = sig.replace("-refine", "");
      console.log(`    ${icon} ${name}`);
    }
  }
  
  console.log();
}

function renderReviewStatus(): void {
  const status = getReviewStatus();
  if (status === "PENDING") return;
  
  console.log(chalk.bold("  Review Status:"));
  switch (status) {
    case "PASS":
      console.log(`    ${chalk.green("✓ PASS")}`);
      break;
    case "PASS_WITH_WARNINGS":
      console.log(`    ${chalk.yellow("⚠ PASS WITH WARNINGS")}`);
      break;
    case "FAIL":
      console.log(`    ${chalk.red("✗ FAIL")}`);
      break;
  }
  console.log();
}

function renderTimeline(): void {
  const events = loadTimeline();
  const recentEvents = events.slice(-5).reverse(); // Last 5, newest first

  if (recentEvents.length === 0) {
    return;
  }

  console.log(chalk.bold("  Recent Timeline:"));
  console.log();

  for (const event of recentEvents) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const type = event.type;
    let typeColor: (text: string) => string;

    switch (type) {
      case "session_start":
        typeColor = chalk.green;
        break;
      case "phase_change":
        typeColor = chalk.blue;
        break;
      case "worker_dispatch":
        typeColor = chalk.yellow;
        break;
      case "worker_complete":
        typeColor = chalk.magenta;
        break;
      case "review":
        typeColor = chalk.cyan;
        break;
      case "error":
        typeColor = chalk.red;
        break;
      default:
        typeColor = chalk.gray;
    }

    console.log(`    ${chalk.dim(time)} ${typeColor(`[${type}]`)} ${event.message}`);
  }

  console.log();
}

function renderBranchHistory(): void {
  const sessions = listBranchSessions();
  const currentBranch = getCurrentBranch();

  if (sessions.length === 0) {
    return;
  }

  console.log(chalk.bold("  Saved Sessions:"));
  console.log();

  for (const branch of sessions.slice(0, 5)) {
    const isCurrent = branch === currentBranch;
    const icon = isCurrent ? chalk.blue("●") : chalk.green("○");
    const name = isCurrent ? chalk.blue(branch) : branch;
    const badge = isCurrent ? chalk.blue(" (current)") : "";
    console.log(`    ${icon} ${name}${badge}`);
  }

  console.log();
}

function renderFooter(): void {
  console.log(chalk.dim("─".repeat(60)));
  console.log(chalk.dim("  Press Ctrl+C to exit"));
  console.log(chalk.dim("  Auto-refresh: every 2 seconds"));
}

export function renderDashboard(): void {
  clearScreen();
  renderHeader();

  const state = loadState();
  state.signals = getSignals();
  state.phase = determinePhase(state.signals);

  renderState(state);
  renderSignals(state.signals);
  renderReviewStatus();
  renderTimeline();
  renderBranchHistory();
  renderFooter();
}

export async function startDashboard(): Promise<void> {
  // Check if we're in a workflow directory
  const workflowDir = join(process.cwd(), WORKFLOW_DIR);
  if (!existsSync(workflowDir)) {
    console.log(chalk.red("Error: No .workflow/ directory found."));
    process.exit(1);
  }
  
  const config = loadConfig();
  const pollInterval = config.dashboard.poll_interval_ms;
  
  // Handle exit
  process.on("SIGINT", () => {
    console.log("\n");
    process.exit(0);
  });
  
  // Initial render
  renderDashboard();
  
  // Poll every 2 seconds
  setInterval(() => {
    renderDashboard();
  }, pollInterval);
  
  // Keep process alive
  await new Promise(() => {});
}
