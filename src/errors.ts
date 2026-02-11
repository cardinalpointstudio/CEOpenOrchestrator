/**
 * Error handling and logging
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ErrorLog, WorkerRole, Phase } from "./types.js";
import { WORKFLOW_DIR } from "./types.js";

const ERRORS_DIR = "errors";

function errorsPath(...parts: string[]): string {
  return join(process.cwd(), WORKFLOW_DIR, ERRORS_DIR, ...parts);
}

export function logError(
  worker: WorkerRole,
  phase: Phase,
  error: string,
  options: {
    lastOutput?: string;
    suggestedAction?: string;
  } = {}
): void {
  const errorsDir = join(process.cwd(), WORKFLOW_DIR, ERRORS_DIR);
  
  // Ensure errors directory exists
  if (!existsSync(errorsDir)) {
    mkdirSync(errorsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const filename = `${worker}-${timestamp.replace(/[:.]/g, "-")}.json`;
  
  const errorLog: ErrorLog = {
    worker,
    timestamp,
    phase,
    error,
    lastOutput: options.lastOutput,
    suggestedAction: options.suggestedAction || "Check the worker window for details",
  };
  
  writeFileSync(join(errorsDir, filename), JSON.stringify(errorLog, null, 2));
}

export function getRecentErrors(limit: number = 5): ErrorLog[] {
  const errorsDir = join(process.cwd(), WORKFLOW_DIR, ERRORS_DIR);
  
  if (!existsSync(errorsDir)) {
    return [];
  }
  
  try {
    const files = readdirSync(errorsDir)
      .filter(f => f.endsWith(".json"))
      .map(f => ({
        name: f,
        path: join(errorsDir, f),
        mtime: existsSync(join(errorsDir, f)) ? statSync(join(errorsDir, f)).mtimeMs : 0,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);
    
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(f.path, "utf-8")) as ErrorLog;
      } catch {
        return null;
      }
    }).filter((e): e is ErrorLog => e !== null);
  } catch {
    return [];
  }
}

export function hasErrors(): boolean {
  return getRecentErrors(1).length > 0;
}

export function clearErrors(): void {
  const errorsDir = join(process.cwd(), WORKFLOW_DIR, ERRORS_DIR);
  
  if (!existsSync(errorsDir)) return;
  
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

export function formatErrorForDisplay(error: ErrorLog): string {
  const lines = [
    `❌ Error in ${error.worker} worker`,
    `   Phase: ${error.phase}`,
    `   Time: ${new Date(error.timestamp).toLocaleString()}`,
    ``,
    `   ${error.error}`,
  ];
  
  if (error.suggestedAction) {
    lines.push(``, `   💡 ${error.suggestedAction}`);
  }
  
  return lines.join("\n");
}

export function formatErrorsForDisplay(errors: ErrorLog[]): string {
  if (errors.length === 0) return "";
  
  const lines = [`⚠️  Recent Errors:`, ``];
  
  for (const error of errors) {
    lines.push(formatErrorForDisplay(error));
    lines.push("");
  }
  
  return lines.join("\n");
}
