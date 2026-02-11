/**
 * Core types for CEOpenOrchestrator
 */

export type Phase = 
  | "init" 
  | "planning" 
  | "implementing" 
  | "reviewing" 
  | "refining" 
  | "compounding" 
  | "complete";

export type WorkerRole = "planner" | "backend" | "frontend" | "tests" | "reviewer";

export type ReviewStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "PENDING";

export interface WorkflowState {
  phase: Phase;
  iteration: number;
  featureName?: string;
  branchName?: string;
  commitCount: number;
  signals: Record<string, boolean>;
  lastUpdated: string;
}

export interface WorkerConfig {
  model: string;
  timeout: number;
}

export interface ScopesConfig {
  backend: string[];
  frontend: string[];
  tests: string[];
}

export interface CommandsConfig {
  test: string | null;
  lint: string | null;
  typecheck: string | null;
}

export interface KeybindingsConfig {
  dispatch_plan: string;
  dispatch_review: string;
  dispatch_refine: string;
  dispatch_compound: string;
  create_pr: string;
  commit_checkpoint: string;
  refresh_status: string;
  new_feature: string;
  open_web: string;
  quit: string;
}

export interface GitConfig {
  auto_commit: boolean;
  branch_prefix: string;
}

export interface DashboardConfig {
  poll_interval_ms: number;
  web_port: number;
  enable_browser: boolean;
}

export interface Config {
  models: Record<WorkerRole, string>;
  timeouts: Record<WorkerRole, number>;
  scopes: ScopesConfig;
  commands: CommandsConfig;
  keybindings: KeybindingsConfig;
  git: GitConfig;
  dashboard: DashboardConfig;
  branches: BranchConfig;
}

export interface ErrorLog {
  worker: WorkerRole;
  timestamp: string;
  phase: Phase;
  error: string;
  lastOutput?: string;
  suggestedAction: string;
}

export interface TimelineEvent {
  timestamp: string;
  type: "phase_change" | "worker_dispatch" | "worker_complete" | "review" | "git" | "error" | "session_start" | "session_resume";
  message: string;
  data?: Record<string, unknown>;
}

export interface SessionMetadata {
  sessionId: string;
  branch: string;
  featureName?: string;
  startedAt: string;
  lastActive: string;
  duration: number; // in minutes
  iterations: number;
  finalPhase?: Phase;
}

export interface BranchTemplate {
  name: string;
  prefix: string;
  description: string;
  format: string;
}

export interface BranchConfig {
  templates: Record<string, BranchTemplate>;
  defaultTemplate: string;
}

export interface ExportData {
  session: SessionMetadata;
  timeline: TimelineEvent[];
  commits: string[];
  finalState: WorkflowState;
  exports: {
    json?: string;
    markdown?: string;
  };
}

export interface FrameworkTemplate {
  name: string;
  scopes: ScopesConfig;
  commands: CommandsConfig;
}

export const SESSION_NAME = "opencode-ce";
export const WORKFLOW_DIR = ".workflow";
export const SIGNALS_DIR = "signals";
export const SESSIONS_DIR = "sessions";
export const EXPORTS_DIR = "exports";

export const WINDOWS = {
  orchestrator: 1,
  planner: 2,
  backend: 3,
  frontend: 4,
  tests: 5,
  reviewer: 6,
  dashboard: 7,
} as const;

export const VALID_PHASES: Phase[] = [
  "init",
  "planning", 
  "implementing",
  "reviewing",
  "refining",
  "compounding",
  "complete"
];

export const WORKER_ROLES: WorkerRole[] = [
  "planner",
  "backend",
  "frontend",
  "tests",
  "reviewer"
];
