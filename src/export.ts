/**
 * Session export functionality - JSON and Markdown formats
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExportData, SessionMetadata, TimelineEvent } from "./types.js";
import { WORKFLOW_DIR, SESSIONS_DIR, EXPORTS_DIR } from "./types.js";
import { loadState } from "./state.js";
import { loadTimeline } from "./timeline.js";
import { getCurrentBranch, getCommitCount, getRecentCommits } from "./git.js";

function getExportsDir(branch: string): string {
  const sanitized = branch.replace(/[/\\]/g, "-");
  return join(process.cwd(), WORKFLOW_DIR, SESSIONS_DIR, sanitized, EXPORTS_DIR);
}

function generateExportFilename(branch: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sanitized = branch.replace(/[/\\]/g, "-");
  return `session-${sanitized}-${timestamp}.${extension}`;
}

function calculateDuration(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function buildExportData(): ExportData {
  const state = loadState();
  const branch = getCurrentBranch();
  const timeline = loadTimeline(branch);
  const commits = getRecentCommits(10);
  
  const startedAt = timeline.length > 0 
    ? timeline[0].timestamp 
    : new Date().toISOString();
  
  const session: SessionMetadata = {
    sessionId: `${branch}-${Date.now()}`,
    branch,
    featureName: state.featureName,
    startedAt,
    lastActive: new Date().toISOString(),
    duration: Math.floor((new Date().getTime() - new Date(startedAt).getTime()) / (1000 * 60)),
    iterations: state.iteration,
    finalPhase: state.phase,
  };
  
  return {
    session,
    timeline,
    commits,
    finalState: state,
    exports: {},
  };
}

export function exportToJSON(): string {
  const data = buildExportData();
  const branch = getCurrentBranch();
  const filename = generateExportFilename(branch, "json");
  const exportsDir = getExportsDir(branch);
  
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true });
  }
  
  const filepath = join(exportsDir, filename);
  
  // Update exports metadata
  data.exports.json = filename;
  
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  
  return filepath;
}

export function exportToMarkdown(): string {
  const data = buildExportData();
  const branch = getCurrentBranch();
  const filename = generateExportFilename(branch, "md");
  const exportsDir = getExportsDir(branch);
  
  if (!existsSync(exportsDir)) {
    mkdirSync(exportsDir, { recursive: true });
  }
  
  const filepath = join(exportsDir, filename);
  
  const markdown = generateMarkdownReport(data);
  
  writeFileSync(filepath, markdown);
  
  return filepath;
}

function generateMarkdownReport(data: ExportData): string {
  const { session, timeline, commits, finalState } = data;
  
  let md = "# Compound Session Report\n\n";
  md += `**Branch:** ${session.branch}  \n`;
  if (session.featureName) {
    md += `**Feature:** ${session.featureName}  \n`;
  }
  md += `**Duration:** ${calculateDuration(session.startedAt)}  \n`;
  md += `**Status:** ${getStatusEmoji(finalState.phase)} ${finalState.phase}  \n`;
  md += `**Iterations:** ${session.iterations}/3  \n\n`;
  
  // Timeline
  md += "## Timeline\n\n";
  md += "| Time | Event |\n";
  md += "|------|-------|\n";
  
  for (const event of timeline) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const emoji = getEventEmoji(event.type);
    md += `| ${time} | ${emoji} ${event.message} |\n`;
  }
  
  md += "\n";
  
  // Commits
  if (commits.length > 0) {
    md += "## Commits\n\n";
    for (const commit of commits) {
      md += `- \`${commit}\`\n`;
    }
    md += "\n";
  }
  
  // Stats
  md += "## Stats\n\n";
  md += `- **Phase:** ${finalState.phase}\n`;
  md += `- **Iteration:** ${finalState.iteration}/3\n`;
  md += `- **Commits:** ${commits.length}\n`;
  
  return md;
}

function getStatusEmoji(phase: string): string {
  const emojis: Record<string, string> = {
    init: "🚀",
    planning: "📝",
    implementing: "⚙️",
    reviewing: "🔍",
    refining: "🔧",
    compounding: "📚",
    complete: "✅",
  };
  return emojis[phase] || "❓";
}

function getEventEmoji(type: string): string {
  const emojis: Record<string, string> = {
    phase_change: "🔄",
    worker_dispatch: "⚙️",
    worker_complete: "✓",
    review: "🔍",
    git: "📝",
    error: "❌",
    session_start: "🚀",
    session_resume: "▶️",
  };
  return emojis[type] || "•";
}

export function getExportHistory(branch: string): string[] {
  const exportsDir = getExportsDir(branch);
  
  if (!existsSync(exportsDir)) {
    return [];
  }
  
  // This would need fs.readdirSync, but avoiding async for now
  // Return empty array - can be enhanced later
  return [];
}
