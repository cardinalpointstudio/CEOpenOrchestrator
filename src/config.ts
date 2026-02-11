/**
 * Configuration management with precedence:
 * 1. Built-in defaults
 * 2. Global config (~/.config/ce-open-orchestrator/config.json)
 * 3. Project config (./.workflow/ce-config.json)
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { Config, WorkerRole } from "./types.js";

const DEFAULT_CONFIG: Config = {
  models: {
    planner: "kimi-k2.5-free",
    backend: "kimi-k2.5-free",
    frontend: "kimi-k2.5-free",
    tests: "kimi-k2.5-free",
    reviewer: "kimi-k2.5-free",
  },
  timeouts: {
    planner: 30,
    backend: 30,
    frontend: 30,
    tests: 30,
    reviewer: 30,
  },
  scopes: {
    backend: ["src/api/**", "src/lib/**", "src/server/**"],
    frontend: ["src/components/**", "src/app/**", "src/pages/**"],
    tests: ["**/*.test.ts", "**/*.spec.ts", "tests/**"],
  },
  commands: {
    test: null,
    lint: null,
    typecheck: null,
  },
  keybindings: {
    dispatch_plan: "p",
    dispatch_review: "r",
    dispatch_refine: "f",
    dispatch_compound: "c",
    create_pr: "g",
    commit_checkpoint: "k",
    refresh_status: "s",
    new_feature: "n",
    open_web: "u",
    quit: "q",
  },
  git: {
    auto_commit: true,
    branch_prefix: "compound/",
  },
  dashboard: {
    poll_interval_ms: 2000,
    web_port: 8080,
    enable_browser: false,
  },
  branches: {
    templates: {
      compound: {
        name: "Compound Feature",
        prefix: "compound/",
        format: "{prefix}{date}-{slug}",
        description: "Standard compound workflow branch",
      },
      feature: {
        name: "Feature Branch",
        prefix: "feature/",
        format: "{prefix}{slug}",
        description: "Standard feature development",
      },
      hotfix: {
        name: "Hotfix",
        prefix: "hotfix/",
        format: "{prefix}{slug}",
        description: "Emergency production fix",
      },
    },
    defaultTemplate: "compound",
  },
};

function getGlobalConfigPath(): string {
  return join(homedir(), ".config", "ce-open-orchestrator", "config.json");
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".workflow", "ce-config.json");
}

function loadJSON(path: string): Partial<Config> | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Partial<Config>;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, ...sources: any[]): any {
  const result = { ...target };

  for (const source of sources) {
    if (!source) continue;

    for (const key in source) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] ?? {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }
  }

  return result;
}

export function loadConfig(): Config {
  const globalConfig = loadJSON(getGlobalConfigPath()) || {};
  const projectConfig = loadJSON(getProjectConfigPath()) || {};
  
  return deepMerge(DEFAULT_CONFIG, globalConfig, projectConfig);
}

export function saveGlobalConfig(config: Partial<Config>): void {
  const configPath = getGlobalConfigPath();
  const configDir = dirname(configPath);
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  const existing = loadJSON(configPath) || {};
  const merged = deepMerge(existing, config);
  
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
}

export function saveProjectConfig(config: Partial<Config>): void {
  const configPath = getProjectConfigPath();
  const configDir = dirname(configPath);
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  
  // Validate timeouts are positive numbers
  for (const [role, timeout] of Object.entries(config.timeouts)) {
    if (typeof timeout !== "number" || timeout <= 0) {
      errors.push(`Invalid timeout for ${role}: must be positive number`);
    }
  }
  
  // Validate scopes are arrays
  for (const [scope, patterns] of Object.entries(config.scopes)) {
    if (!Array.isArray(patterns)) {
      errors.push(`Invalid scopes.${scope}: must be array of strings`);
    }
  }
  
  // Validate poll interval
  if (config.dashboard.poll_interval_ms < 500) {
    errors.push("Invalid poll_interval_ms: must be at least 500ms");
  }
  
  return errors;
}

export function getModelForWorker(config: Config, role: WorkerRole): string {
  return config.models[role] || DEFAULT_CONFIG.models[role];
}

export function getTimeoutForWorker(config: Config, role: WorkerRole): number {
  return config.timeouts[role] || DEFAULT_CONFIG.timeouts[role];
}
