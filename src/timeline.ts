/**
 * Timeline event tracking for compound sessions
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TimelineEvent } from "./types.js";
import { WORKFLOW_DIR, SESSIONS_DIR } from "./types.js";
import { getCurrentBranch } from "./git.js";

const TIMELINE_FILE = "timeline.json";

function getSessionsDir(): string {
  return join(process.cwd(), WORKFLOW_DIR, SESSIONS_DIR);
}

function getBranchDir(branch: string): string {
  // Sanitize branch name for filesystem
  const sanitized = branch.replace(/[/\\]/g, "-");
  return join(getSessionsDir(), sanitized);
}

function getTimelinePath(branch?: string): string {
  const targetBranch = branch || getCurrentBranch();
  return join(getBranchDir(targetBranch), TIMELINE_FILE);
}

export function initializeTimeline(): void {
  const branch = getCurrentBranch();
  const branchDir = getBranchDir(branch);
  
  if (!existsSync(branchDir)) {
    mkdirSync(branchDir, { recursive: true });
  }
  
  const timelinePath = getTimelinePath(branch);
  
  if (!existsSync(timelinePath)) {
    // Create new timeline with session start event
    const initialEvent: TimelineEvent = {
      timestamp: new Date().toISOString(),
      type: "session_start",
      message: `Session started on branch: ${branch}`,
      data: { branch },
    };
    
    saveTimeline([initialEvent], branch);
  }
}

export function addTimelineEvent(
  type: TimelineEvent["type"],
  message: string,
  data?: Record<string, unknown>
): void {
  const branch = getCurrentBranch();
  const events = loadTimeline(branch);
  
  const event: TimelineEvent = {
    timestamp: new Date().toISOString(),
    type,
    message,
    data,
  };
  
  events.push(event);
  saveTimeline(events, branch);
}

export function loadTimeline(branch?: string): TimelineEvent[] {
  const timelinePath = getTimelinePath(branch);
  
  if (!existsSync(timelinePath)) {
    return [];
  }
  
  try {
    const content = readFileSync(timelinePath, "utf-8");
    return JSON.parse(content) as TimelineEvent[];
  } catch {
    return [];
  }
}

function saveTimeline(events: TimelineEvent[], branch?: string): void {
  const timelinePath = getTimelinePath(branch);
  
  // Ensure directory exists
  const dir = join(timelinePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(timelinePath, JSON.stringify(events, null, 2));
}

export function getRecentEvents(limit: number = 10, branch?: string): TimelineEvent[] {
  const events = loadTimeline(branch);
  return events.slice(-limit);
}

export function formatTimelineForDisplay(events: TimelineEvent[]): string {
  return events
    .map((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      return `${time} → ${event.message}`;
    })
    .join("\n");
}

// Convenience functions for common events
export function logPhaseChange(phase: string, iteration?: number): void {
  addTimelineEvent("phase_change", `Phase changed to: ${phase}`, {
    phase,
    iteration,
  });
}

export function logWorkerDispatch(worker: string, window: number): void {
  addTimelineEvent("worker_dispatch", `${worker} worker dispatched`, {
    worker,
    window,
  });
}

export function logWorkerComplete(worker: string): void {
  addTimelineEvent("worker_complete", `${worker} worker completed`, {
    worker,
  });
}

export function logReview(status: string): void {
  addTimelineEvent("review", `Review completed: ${status}`, {
    status,
  });
}

export function logGit(operation: string, details: string): void {
  addTimelineEvent("git", `Git ${operation}: ${details}`, {
    operation,
    details,
  });
}

export function logError(message: string, error?: string): void {
  addTimelineEvent("error", `Error: ${message}`, {
    message,
    error,
  });
}