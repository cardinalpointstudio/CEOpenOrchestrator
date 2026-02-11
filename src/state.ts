/**
 * State machine and signal management
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Phase, WorkflowState, ReviewStatus, WorkerRole } from "./types.js";
import { WORKFLOW_DIR, SIGNALS_DIR, SESSIONS_DIR } from "./types.js";

const STATE_FILE = "state.json";
const REVIEW_FILE = "REVIEW.md";

function workflowPath(...parts: string[]): string {
  return join(process.cwd(), WORKFLOW_DIR, ...parts);
}

export function getInitialState(): WorkflowState {
  return {
    phase: "init",
    iteration: 1,
    commitCount: 0,
    signals: {},
    lastUpdated: new Date().toISOString(),
  };
}

export function loadState(): WorkflowState {
  const statePath = workflowPath(STATE_FILE);
  
  if (!existsSync(statePath)) {
    return getInitialState();
  }
  
  try {
    const content = readFileSync(statePath, "utf-8");
    return JSON.parse(content) as WorkflowState;
  } catch {
    return getInitialState();
  }
}

export function saveState(state: WorkflowState): void {
  const statePath = workflowPath(STATE_FILE);
  const signalsDir = workflowPath(SIGNALS_DIR);
  
  // Ensure directories exist
  if (!existsSync(signalsDir)) {
    mkdirSync(signalsDir, { recursive: true });
  }
  
  // Update timestamp
  const updatedState = {
    ...state,
    lastUpdated: new Date().toISOString(),
  };
  
  // Atomic write
  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(updatedState, null, 2));
  writeFileSync(statePath, readFileSync(tempPath));
  try {
    unlinkSync(tempPath);
  } catch {
    // Ignore cleanup errors
  }
}

export function getSignals(): Record<string, boolean> {
  const signalsDir = workflowPath(SIGNALS_DIR);
  
  if (!existsSync(signalsDir)) {
    return {};
  }
  
  const signals: Record<string, boolean> = {};
  
  try {
    const files = readdirSync(signalsDir);
    for (const file of files) {
      if (file.endsWith(".done")) {
        const name = file.replace(".done", "");
        signals[name] = true;
      }
    }
  } catch {
    // Directory might not exist or be readable
  }
  
  return signals;
}

export function createSignal(name: string): void {
  const signalsDir = workflowPath(SIGNALS_DIR);
  
  if (!existsSync(signalsDir)) {
    mkdirSync(signalsDir, { recursive: true });
  }
  
  const signalPath = join(signalsDir, `${name}.done`);
  writeFileSync(signalPath, new Date().toISOString());
}

export function clearSignal(name: string): void {
  const signalPath = workflowPath(SIGNALS_DIR, `${name}.done`);
  if (existsSync(signalPath)) {
    unlinkSync(signalPath);
  }
}

export function clearAllSignals(): void {
  const signalsDir = workflowPath(SIGNALS_DIR);
  
  if (!existsSync(signalsDir)) return;
  
  try {
    const files = readdirSync(signalsDir);
    for (const file of files) {
      if (file.endsWith(".done")) {
        unlinkSync(join(signalsDir, file));
      }
    }
  } catch {
    // Ignore errors
  }
}

export function getReviewStatus(): ReviewStatus {
  const reviewPath = workflowPath(REVIEW_FILE);
  
  if (!existsSync(reviewPath)) {
    return "PENDING";
  }
  
  // Check if review signal exists
  const signals = getSignals();
  if (!signals.review) {
    return "PENDING";
  }
  
  try {
    const content = readFileSync(reviewPath, "utf-8");
    
    if (content.includes("STATUS: PASS")) {
      // Check if it's pass with warnings
      if (content.includes("PASS_WITH_WARNINGS") || 
          (content.includes("Warnings") && content.includes("Non-blocking"))) {
        return "PASS_WITH_WARNINGS";
      }
      return "PASS";
    }
    
    if (content.includes("STATUS: FAIL")) {
      return "FAIL";
    }
  } catch {
    // File not readable
  }
  
  return "PENDING";
}

export function determinePhase(signals: Record<string, boolean>): Phase {
  // Check if workflow is complete
  if (signals.compound || signals.pr) {
    return "complete";
  }
  
  const reviewStatus = getReviewStatus();
  
  // Check if compounding is done
  if (signals.compound) {
    return "compounding";
  }
  
  // Check if review passed
  if (signals.review && (reviewStatus === "PASS" || reviewStatus === "PASS_WITH_WARNINGS")) {
    return "compounding";
  }
  
  // Check if refine is complete
  const refineSignals = ["backend-refine", "frontend-refine", "tests-refine"];
  const allRefinesDone = refineSignals.every(s => signals[s]);
  
  if (signals.review && reviewStatus === "FAIL") {
    if (allRefinesDone) {
      // Refine complete, ready for re-review
      return "reviewing";
    }
    // Still refining
    return "refining";
  }
  
  // Check if implementation is complete
  if (signals.backend && signals.frontend && signals.tests) {
    return "reviewing";
  }
  
  // Check if planning is done
  if (signals.plan || existsSync(workflowPath("PLAN.md"))) {
    if (signals.plan) {
      return "implementing";
    }
    return "planning";
  }
  
  return "init";
}

export function updateStateFromSignals(): WorkflowState {
  const state = loadState();
  const signals = getSignals();
  const newPhase = determinePhase(signals);
  
  // Only update phase if it changed
  if (newPhase !== state.phase) {
    state.phase = newPhase;
  }
  
  state.signals = signals;
  saveState(state);
  
  return state;
}

export function clearWorkflow(): void {
  clearAllSignals();
  
  // Clear state
  const initialState = getInitialState();
  saveState(initialState);
  
  // Clear error logs
  const errorsDir = workflowPath("errors");
  if (existsSync(errorsDir)) {
    try {
      const files = readdirSync(errorsDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          unlinkSync(join(errorsDir, file));
        }
      }
    } catch {
      // Ignore errors
    }
  }
}

export function isWorkerDone(role: WorkerRole, isRefine = false): boolean {
  const signals = getSignals();
  const signalName = isRefine ? `${role}-refine` : role;
  return !!signals[signalName];
}

export function areAllWorkersDone(isRefine = false): boolean {
  const workers: WorkerRole[] = ["backend", "frontend", "tests"];
  return workers.every(role => isWorkerDone(role, isRefine));
}

// Session management for branch-based workflow isolation

export function getBranchSessionPath(branch: string): string {
  return workflowPath(SESSIONS_DIR, branch);
}

export function saveSessionToBranch(branch: string): void {
  const currentState = loadState();
  const sessionPath = getBranchSessionPath(branch);
  
  // Create session directory if it doesn't exist
  if (!existsSync(sessionPath)) {
    mkdirSync(sessionPath, { recursive: true });
  }
  
  // Save state to branch-specific session
  const branchStatePath = join(sessionPath, STATE_FILE);
  const stateWithBranch = {
    ...currentState,
    branchName: branch,
    lastUpdated: new Date().toISOString(),
  };
  
  writeFileSync(branchStatePath, JSON.stringify(stateWithBranch, null, 2));
  
  // Copy signals if they exist
  const currentSignals = getSignals();
  if (Object.keys(currentSignals).length > 0) {
    const signalsPath = join(sessionPath, SIGNALS_DIR);
    if (!existsSync(signalsPath)) {
      mkdirSync(signalsPath, { recursive: true });
    }
    
    for (const [signalName] of Object.entries(currentSignals)) {
      const signalFile = join(signalsPath, `${signalName}.done`);
      writeFileSync(signalFile, new Date().toISOString());
    }
  }
}

export function loadSessionFromBranch(branch: string): WorkflowState | null {
  const sessionPath = getBranchSessionPath(branch);
  const branchStatePath = join(sessionPath, STATE_FILE);
  
  if (!existsSync(branchStatePath)) {
    return null;
  }
  
  try {
    const content = readFileSync(branchStatePath, "utf-8");
    const branchState = JSON.parse(content) as WorkflowState;
    
    // Restore to main workflow state
    saveState(branchState);
    
    // Restore signals
    const signalsPath = join(sessionPath, SIGNALS_DIR);
    if (existsSync(signalsPath)) {
      clearAllSignals();
      try {
        const signalFiles = readdirSync(signalsPath);
        for (const file of signalFiles) {
          if (file.endsWith(".done")) {
            const signalName = file.replace(".done", "");
            createSignal(signalName);
          }
        }
      } catch {
        // Ignore signal restore errors
      }
    }
    
    return branchState;
  } catch {
    return null;
  }
}

export function listBranchSessions(): string[] {
  const sessionsDir = workflowPath(SESSIONS_DIR);
  
  if (!existsSync(sessionsDir)) {
    return [];
  }
  
  try {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

export function clearBranchSession(branch: string): boolean {
  const sessionPath = getBranchSessionPath(branch);
  
  if (!existsSync(sessionPath)) {
    return false;
  }
  
  try {
    // Delete all files in the session directory
    const deleteDir = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          deleteDir(fullPath);
        } else {
          unlinkSync(fullPath);
        }
      }
    };
    
    deleteDir(sessionPath);
    
    // Remove the empty directory
    try {
      const remaining = readdirSync(sessionPath);
      if (remaining.length === 0) {
        // Node's rmdirSync can remove empty directories
        // But we need to be careful about platform differences
        const { rmdirSync } = require("node:fs");
        rmdirSync(sessionPath);
      }
    } catch {
      // Directory might not be empty or already deleted
    }
    
    return true;
  } catch {
    return false;
  }
}
