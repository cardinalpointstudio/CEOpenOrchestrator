#!/usr/bin/env bun

/**
 * CLI entry point for CEOpenOrchestrator
 */

import { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync, spawn } from "node:child_process";
import { startOrchestrator } from "./orchestrator.js";
import { startDashboard } from "./dashboard.js";
import { loadConfig, saveProjectConfig } from "./config.js";
import { analyzeProject, formatConfigForDisplay } from "./project-detector.js";
import { getInitialState, saveState, clearWorkflow, createSignal } from "./state.js";
import { validateGitSetup, createCheckpointCommit, getCurrentBranch, getCommitCount } from "./git.js";
import { WORKFLOW_DIR, SIGNALS_DIR, SESSION_NAME } from "./types.js";
import * as readline from "node:readline";

function setupTmuxSession(projectDir: string): void {
  // Check if session already exists
  try {
    execSync(`tmux has-session -t ${SESSION_NAME} 2>/dev/null`);
    console.log(chalk.yellow(`Session '${SESSION_NAME}' already exists. Attaching...`));
    
    // Rename windows to ensure correct names before attaching
    execSync(`tmux rename-window -t ${SESSION_NAME}:1 "Orch" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:2 "PM" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:3 "Backend" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:4 "Frontend" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:5 "Tests" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:6 "Review" 2>/dev/null || true`);
    execSync(`tmux rename-window -t ${SESSION_NAME}:7 "Dashboard" 2>/dev/null || true`);
    
    execSync(`tmux attach -t ${SESSION_NAME}`);
    return;
  } catch {
    // Session doesn't exist, create it
  }

  console.log(chalk.blue("Creating tmux session..."));

  // Create session with first window
  execSync(`tmux new-session -d -s ${SESSION_NAME} -n "Orch" -c "${projectDir}"`);

  // Create worker windows
  execSync(`tmux new-window -t ${SESSION_NAME} -n "PM" -c "${projectDir}"`);
  execSync(`tmux new-window -t ${SESSION_NAME} -n "Backend" -c "${projectDir}"`);
  execSync(`tmux new-window -t ${SESSION_NAME} -n "Frontend" -c "${projectDir}"`);
  execSync(`tmux new-window -t ${SESSION_NAME} -n "Tests" -c "${projectDir}"`);
  execSync(`tmux new-window -t ${SESSION_NAME} -n "Review" -c "${projectDir}"`);
  execSync(`tmux new-window -t ${SESSION_NAME} -n "Dashboard" -c "${projectDir}"`);

  // Select orchestrator window
  execSync(`tmux select-window -t ${SESSION_NAME}:1`);

  // Rename windows to ensure correct names (handles both new and existing sessions)
  execSync(`tmux rename-window -t ${SESSION_NAME}:1 "Orch" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:2 "PM" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:3 "Backend" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:4 "Frontend" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:5 "Tests" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:6 "Review" 2>/dev/null || true`);
  execSync(`tmux rename-window -t ${SESSION_NAME}:7 "Dashboard" 2>/dev/null || true`);

  console.log(chalk.green("✓ Tmux session created"));
}

const program = new Command();

program
  .name("ce-orchestrate")
  .description("Parallel workflow orchestration for OpenCode")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize CEOpenOrchestrator for this project")
  .action(async () => {
    console.log(chalk.blue("\n⚡ CEOpenOrchestrator Initialization\n"));

    // Check git setup
    console.log(chalk.dim("Checking git setup..."));
    const gitCheck = validateGitSetup();
    if (!gitCheck.valid) {
      console.log(chalk.yellow("\n⚠️  Git warnings:"));
      for (const error of gitCheck.errors) {
        console.log(`  - ${error}`);
      }
      console.log();
    }

    // Create .workflow directory
    const workflowDir = join(process.cwd(), WORKFLOW_DIR);
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { recursive: true });
      mkdirSync(join(workflowDir, SIGNALS_DIR), { recursive: true });
      console.log(chalk.green("✓ Created .workflow/ directory"));
    } else {
      console.log(chalk.dim("✓ .workflow/ already exists"));
    }

    // Analyze project
    console.log(chalk.dim("\nAnalyzing project structure..."));
    const analysis = analyzeProject();

    console.log(chalk.blue(`\nDetected framework: ${analysis.framework}`));
    console.log("\nSuggested configuration:");
    console.log(formatConfigForDisplay(analysis));

    // Ask user for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.yellow("\nAccept? [Y/n/edit]: "), (response) => {
        resolve(response.trim().toLowerCase());
        rl.close();
      });
    });

    if (answer === "edit" || answer === "e") {
      // TODO: Interactive editing
      console.log(chalk.dim("Interactive editing not yet implemented. Using defaults."));
    }

    // Save config
    if (answer !== "n" && answer !== "no") {
      saveProjectConfig({
        scopes: analysis.scopes,
        commands: analysis.commands,
      });
      console.log(chalk.green("\n✓ Configuration saved to .workflow/ce-config.json"));
    }

    // Initialize state
    const state = getInitialState();
    saveState(state);
    console.log(chalk.green("✓ Initialized workflow state"));

    console.log(chalk.blue("\n🎉 Ready to go!"));
    console.log(chalk.dim("\nNext steps:"));
    console.log("  1. Run: ce-orchestrate start");
    console.log("  2. In the Plan window, describe your feature\n");
  });

program
  .command("start")
  .description("Start the orchestration session (creates tmux)")
  .action(() => {
    const projectDir = process.cwd();
    
    // Check if .workflow exists
    const workflowDir = join(projectDir, WORKFLOW_DIR);
    if (!existsSync(workflowDir)) {
      console.log(chalk.red("Error: No .workflow/ directory found."));
      console.log("Run 'ce-orchestrate init' first.");
      process.exit(1);
    }

    // Get the script path
    const scriptPath = join(__dirname, "..", "scripts", "ce-start-tmux.sh");
    
    // Execute the tmux setup script
    try {
      execSync(`bash "${scriptPath}" "${projectDir}"`, { stdio: "inherit" });
    } catch (e) {
      // User probably detached or quit tmux
      process.exit(0);
    }
  });

program
  .command("start-internal")
  .description("Start orchestrator inside tmux (called by tmux)")
  .action(async () => {
    await startOrchestrator();
  });

program
  .command("dashboard")
  .description("Start live dashboard (runs in window 7)")
  .action(async () => {
    await startDashboard();
  });

program
  .command("web")
  .description("Start web dashboard server")
  .option("-p, --port <port>", "Port to run server on", "8080")
  .action(async (options) => {
    const port = Number.parseInt(options.port, 10);
    const { startWebServer } = await import("./web-server.js");
    await startWebServer(port);
  });

program
  .command("status")
  .description("Show current workflow status")
  .action(async () => {
    const workflowDir = join(process.cwd(), WORKFLOW_DIR);
    if (!existsSync(workflowDir)) {
      console.log(chalk.red("Error: No .workflow/ directory found."));
      console.log("Run 'ce-orchestrate init' first.");
      process.exit(1);
    }

    const { loadState, getSignals, determinePhase } = await import("./state.js");
    const { getCurrentBranch, getCommitCount } = await import("./git.js");

    const state = loadState();
    const signals = getSignals();
    const phase = determinePhase(signals);
    const branch = getCurrentBranch();
    const commits = getCommitCount();

    console.log(chalk.blue("\n⚡ CEOpenOrchestrator Status\n"));
    console.log(`Phase: ${chalk.cyan(phase)}`);
    console.log(`Branch: ${chalk.cyan(branch)}`);
    console.log(`Commits: ${commits}`);
    console.log(`Iteration: ${state.iteration}/3`);
    
    if (state.featureName) {
      console.log(`Feature: ${state.featureName}`);
    }

    console.log("\nSignals:");
    for (const [key, value] of Object.entries(signals)) {
      console.log(`  ${value ? chalk.green("✓") : chalk.gray("○")} ${key}`);
    }
    console.log();
  });

program
  .command("reset")
  .description("Reset workflow state (clear signals)")
  .action(() => {
    const workflowDir = join(process.cwd(), WORKFLOW_DIR);
    if (!existsSync(workflowDir)) {
      console.log(chalk.red("Error: No .workflow/ directory found."));
      process.exit(1);
    }

    console.log(chalk.yellow("Resetting workflow state..."));
    clearWorkflow();
    console.log(chalk.green("✓ Workflow reset\n"));
  });

program
  .command("signal <name>")
  .description("Manually create a signal file")
  .action(async (name: string) => {
    const { createSignal } = await import("./state.js");
    createSignal(name);
    console.log(chalk.green(`✓ Created signal: ${name}.done\n`));
  });

program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    const config = loadConfig();
    console.log(chalk.blue("\n⚡ Current Configuration\n"));
    console.log(JSON.stringify(config, null, 2));
    console.log();
  });

program
  .command("detach")
  .description("Detach from the tmux session (keeps session running)")
  .action(() => {
    try {
      execSync(`tmux has-session -t ${SESSION_NAME} 2>/dev/null`);
      execSync(`tmux detach -s ${SESSION_NAME}`);
      console.log(chalk.green(`✓ Detached from session '${SESSION_NAME}'`));
      console.log(chalk.dim("Session is still running. Use 'ce-orchestrate attach' to reconnect."));
    } catch {
      console.log(chalk.yellow(`No active session '${SESSION_NAME}' found`));
    }
  });

program
  .command("stop")
  .description("Gracefully stop the tmux session (sends quit signal to orchestrator)")
  .action(() => {
    try {
      execSync(`tmux has-session -t ${SESSION_NAME} 2>/dev/null`);
      console.log(chalk.blue(`Gracefully stopping session '${SESSION_NAME}'...`));
      
      // Send 'q' key to orchestrator window to trigger graceful exit
      try {
        execSync(`tmux send-keys -t ${SESSION_NAME}:1 q`);
        // Wait a moment for graceful shutdown
        execSync("sleep 2");
      } catch {
        // Window might already be closed
      }
      
      // Kill the session
      execSync(`tmux kill-session -t ${SESSION_NAME}`);
      console.log(chalk.green(`✓ Stopped session '${SESSION_NAME}'`));
    } catch {
      console.log(chalk.yellow(`No active session '${SESSION_NAME}' found`));
    }
  });

program
  .command("kill")
  .description("Force kill the tmux session (destroys all windows immediately)")
  .action(() => {
    try {
      execSync(`tmux has-session -t ${SESSION_NAME} 2>/dev/null`);
      execSync(`tmux kill-session -t ${SESSION_NAME}`);
      console.log(chalk.green(`✓ Killed session '${SESSION_NAME}'`));
    } catch {
      console.log(chalk.yellow(`No active session '${SESSION_NAME}' found`));
    }
  });

program
  .command("attach")
  .description("Attach to existing tmux session")
  .action(() => {
    try {
      execSync(`tmux has-session -t ${SESSION_NAME} 2>/dev/null`);
      execSync(`tmux attach -t ${SESSION_NAME}`, { stdio: "inherit" });
    } catch {
      console.log(chalk.red(`No active session '${SESSION_NAME}' found`));
      console.log(chalk.dim("Run 'ce-orchestrate start' to create a new session."));
      process.exit(1);
    }
  });

program.parse();
