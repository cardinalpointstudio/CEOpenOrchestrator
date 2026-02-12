/**
 * Enhanced WebSocket server for browser dashboard
 * Supports bidirectional communication, tmux streaming, and input injection
 */

import { serve, type ServerWebSocket } from "bun";
import { existsSync, readFileSync, watch, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync, spawn } from "node:child_process";
import type { Config } from "./types.js";

// Determine web directory - check multiple locations
function findWebDir(): string {
  // Option 1: Running from project root (development)
  const devPath = join(process.cwd(), "web");
  if (existsSync(devPath)) return devPath;

  // Option 2: Running from dist/ in project
  const distPath = join(process.cwd(), "..", "web");
  if (existsSync(distPath)) return distPath;

  // Option 3: Try to find from process.argv[0] (the executable)
  const execPath = process.argv[1] || process.execPath;
  if (execPath) {
    const execWebPath = join(execPath, "..", "..", "web");
    if (existsSync(execWebPath)) return execWebPath;
  }

  // Option 4: Check common installation paths
  const homePath = join(process.env.HOME || "", ".ce-orchestrator", "web");
  if (existsSync(homePath)) return homePath;

  // Fallback to dev path (will fail gracefully with 404)
  return devPath;
}

const WEB_DIR = findWebDir();
import { WORKFLOW_DIR, SESSION_NAME, WINDOWS, EXPORTS_DIR } from "./types.js";
import { loadState, getSignals, determinePhase } from "./state.js";
import { getReviewStatus } from "./state.js";
import { saveSessionToBranch, loadSessionFromBranch, listBranchSessions, clearBranchSession, clearWorkflow } from "./state.js";
import { getCurrentBranch, getCommitCount, getRecentBranches, getCommitsAheadBehind, isMainBranch, switchBranch, createBranchFromTemplate } from "./git.js";
import { loadConfig } from "./config.js";
import { exportToJSON, exportToMarkdown } from "./export.js";
import { loadTimeline } from "./timeline.js";

// Store connected clients
const clients = new Set<ServerWebSocket<unknown>>();

// Store tmux output streams
const outputBuffers: Map<number, string[]> = new Map();
const MAX_BUFFER_SIZE = 1000;

interface DashboardState {
  phase: string;
  iteration: number;
  featureName?: string;
  branch: string;
  commits: number;
  signals: Record<string, boolean>;
  reviewStatus: string;
  timestamp: string;
  isMainBranch: boolean;
  branchStatus: {
    ahead: number;
    behind: number;
  };
  recentBranches: string[];
  sessionInfo: {
    hasSession: boolean;
    lastActive?: string;
    timelineEvents: number;
  };
}

// Get current dashboard state
function getDashboardState(): DashboardState {
  const state = loadState();
  const signals = getSignals();
  const branch = getCurrentBranch();
  const branchStatus = getCommitsAheadBehind();
  const timeline = loadTimeline(branch);

  return {
    phase: determinePhase(signals),
    iteration: state.iteration,
    featureName: state.featureName,
    branch,
    commits: getCommitCount(),
    signals,
    reviewStatus: getReviewStatus(),
    timestamp: new Date().toISOString(),
    isMainBranch: isMainBranch(),
    branchStatus,
    recentBranches: getRecentBranches(10),
    sessionInfo: {
      hasSession: Object.keys(signals).length > 0 || state.phase !== "init",
      lastActive: state.lastUpdated,
      timelineEvents: timeline.length,
    },
  };
}

// Broadcast state to all connected clients
function broadcastState(): void {
  const state = getDashboardState();
  const message = JSON.stringify({
    type: "state",
    data: state,
  });
  
  for (const client of clients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    } catch {
      clients.delete(client);
    }
  }
}

// Capture tmux output from a window
function captureTmuxOutput(windowNum: number): string {
  try {
    const output = execSync(
      `tmux capture-pane -t ${SESSION_NAME}:${windowNum} -p`,
      { encoding: "utf-8", timeout: 1000 }
    );
    return output;
  } catch {
    return "";
  }
}

// Stream tmux output to clients
function streamWindowOutput(windowNum: number): void {
  const output = captureTmuxOutput(windowNum);
  
  if (!outputBuffers.has(windowNum)) {
    outputBuffers.set(windowNum, []);
  }
  
  const buffer = outputBuffers.get(windowNum);
  const lines = output.split("\n");
  
  // Add new lines to buffer
  for (const line of lines) {
    if (line.trim()) {
      buffer.push(line);
      // Keep buffer size limited
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
      }
    }
  }
  
  // Broadcast to clients
  const message = JSON.stringify({
    type: "output",
    window: windowNum,
    content: output,
    timestamp: new Date().toISOString(),
  });
  
  for (const client of clients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    } catch {
      clients.delete(client);
    }
  }
}

// Send keystrokes to tmux window
function sendKeystrokes(windowNum: number, keys: string): boolean {
  try {
    execSync(`tmux send-keys -t ${SESSION_NAME}:${windowNum} '${keys.replace(/'/g, "'\"'\"'")}'`);
    return true;
  } catch (e) {
    console.error(`Failed to send keystrokes to window ${windowNum}:`, e);
    return false;
  }
}

// Send prompt to tmux window (enters the text)
function sendPrompt(windowNum: number, prompt: string): boolean {
  try {
    // Clear any existing input first
    execSync(`tmux send-keys -t ${SESSION_NAME}:${windowNum} C-c`);
    // Send the prompt text
    execSync(`tmux send-keys -t ${SESSION_NAME}:${windowNum} '${prompt.replace(/'/g, "'\"'\"'")}'`);
    // Press Enter
    execSync(`tmux send-keys -t ${SESSION_NAME}:${windowNum} Enter`);
    return true;
  } catch (e) {
    console.error(`Failed to send prompt to window ${windowNum}:`, e);
    return false;
  }
}

// Focus tmux window
function focusWindow(windowNum: number): boolean {
  try {
    execSync(`tmux select-window -t ${SESSION_NAME}:${windowNum}`);
    return true;
  } catch (e) {
    console.error(`Failed to focus window ${windowNum}:`, e);
    return false;
  }
}

// Get MIME type for static files
function getMimeType(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain";
}

// Serve static file
function serveStaticFile(filePath: string): Response {
  const fullPath = join(WEB_DIR, filePath);

  if (!existsSync(fullPath)) {
    return new Response("Not found", { status: 404 });
  }
  
  try {
    const content = readFileSync(fullPath);
    return new Response(content, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  } catch {
    return new Response("Error reading file", { status: 500 });
  }
}

// Start streaming intervals
let streamingInterval: ReturnType<typeof setInterval> | null = null;

function startStreaming(): void {
  if (streamingInterval) return;
  
  // Stream output from all worker windows every 500ms
  streamingInterval = setInterval(() => {
    const windows = [WINDOWS.planner, WINDOWS.backend, WINDOWS.frontend, WINDOWS.tests, WINDOWS.reviewer];
    for (const window of windows) {
      streamWindowOutput(window);
    }
  }, 500);
}

function stopStreaming(): void {
  if (streamingInterval) {
    clearInterval(streamingInterval);
    streamingInterval = null;
  }
}

// Main server function
export async function startWebServer(port = 8080): Promise<void> {
  const projectDir = process.cwd();
  
  // Check if workflow exists
  const workflowDir = join(projectDir, WORKFLOW_DIR);
  if (!existsSync(workflowDir)) {
    console.error("Error: No .workflow/ directory found.");
    console.error("Run 'ce-orchestrate init' first.");
    process.exit(1);
  }
  
  // Check if tmux session exists
  try {
    execSync(`tmux has-session -t ${SESSION_NAME}`, { stdio: "ignore" });
  } catch {
    console.error(`Error: Tmux session '${SESSION_NAME}' not found.`);
    console.error("Run 'ce-orchestrate start' first.");
    process.exit(1);
  }
  
  // Check if port is available
  try {
    const testServer = serve({ port, fetch: () => new Response("test") });
    await testServer.stop();
  } catch {
    console.error(`⚠️  Port ${port} is already in use`);
    console.error("\nOptions:");
    console.error(`1. Stop the process using port ${port}`);
    console.error("2. Use a different port: ce-orchestrate web --port 8081");
    console.error("3. Configure in .workflow/ce-config.json:");
    console.error('   { "dashboard": { "web_port": 8081 } }');
    process.exit(1);
  }
  
  // Start the server
  const server = serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);
      
      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const success = server.upgrade(req);
        if (success) {
          return undefined as unknown as Response;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      
      // Static files
      if (url.pathname === "/") {
        return serveStaticFile("index.html");
      }
      
      // API endpoints - MUST be checked before static files
      if (url.pathname.startsWith("/api/")) {
        // State endpoint
        if (url.pathname === "/api/state") {
          return new Response(JSON.stringify(getDashboardState()), {
            headers: { "Content-Type": "application/json" },
          });
        }
        
        // Output endpoint
        if (url.pathname === "/api/output") {
          const windowNum = Number.parseInt(url.searchParams.get("window") || "0");
          if (windowNum && outputBuffers.has(windowNum)) {
            return new Response(
              JSON.stringify({ output: outputBuffers.get(windowNum) }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("[]", { headers: { "Content-Type": "application/json" } });
        }

        // Branch management endpoints
        if (url.pathname === "/api/branches") {
          try {
            const branches = getRecentBranches(10);
            const current = getCurrentBranch();
            return new Response(JSON.stringify({
              current,
              recent: branches,
              isMain: isMainBranch(),
            }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            console.error("Error fetching branches:", error);
            return new Response(JSON.stringify({
              current: getCurrentBranch(),
              recent: [],
              isMain: false,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Session management endpoints
        if (url.pathname === "/api/sessions") {
          return new Response(JSON.stringify({
            current: getCurrentBranch(),
            sessions: listBranchSessions(),
            timeline: loadTimeline(),
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Export endpoints
        if (url.pathname === "/api/export/json") {
          try {
            const filepath = exportToJSON();
            return new Response(JSON.stringify({ success: true, filepath }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Export failed",
            }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }

        if (url.pathname === "/api/export/markdown") {
          try {
            const filepath = exportToMarkdown();
            return new Response(JSON.stringify({ success: true, filepath }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Export failed",
            }), { status: 500, headers: { "Content-Type": "application/json" } });
          }
        }

        // Timeline endpoint - last 10 events
        if (url.pathname === "/api/timeline") {
          try {
            const events = loadTimeline();
            const recentEvents = events.slice(-10).reverse(); // Last 10, newest first
            return new Response(JSON.stringify({
              events: recentEvents,
              total: events.length,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({
              events: [],
              total: 0,
              error: error instanceof Error ? error.message : "Failed to load timeline",
            }), {
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        // Project stats endpoint
        if (url.pathname === "/api/project-stats") {
          try {
            const state = loadState();
            const branchStatus = getCommitsAheadBehind();
            const sessions = listBranchSessions();
            const timeline = loadTimeline();
            
            // Check for recent exports
            const exportsDir = join(process.cwd(), WORKFLOW_DIR, EXPORTS_DIR);
            let lastExport = null;
            try {
              if (existsSync(exportsDir)) {
                const exportFiles = readdirSync(exportsDir)
                  .filter(f => f.endsWith('.json') || f.endsWith('.md'))
                  .map(f => ({
                    name: f,
                    time: statSync(join(exportsDir, f)).mtime,
                  }))
                  .sort((a, b) => b.time.getTime() - a.time.getTime());
                
                if (exportFiles.length > 0) {
                  lastExport = {
                    filename: exportFiles[0].name,
                    timestamp: exportFiles[0].time.toISOString(),
                  };
                }
              }
            } catch {
              // Ignore export check errors
            }

            return new Response(JSON.stringify({
              featureName: state.featureName,
              branch: getCurrentBranch(),
              phase: state.phase,
              iteration: state.iteration,
              commits: {
                ahead: branchStatus.ahead,
                behind: branchStatus.behind,
              },
              lastActivity: state.lastUpdated,
              timelineEvents: timeline.length,
              savedSessions: sessions.length,
              lastExport,
            }), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return new Response(JSON.stringify({
              error: error instanceof Error ? error.message : "Failed to load project stats",
            }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        
        // Unknown API endpoint
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      
      // Static files
      if (url.pathname === "/") {
        return serveStaticFile("index.html");
      }

      // Serve other static files
      const filePath = url.pathname.slice(1);
      return serveStaticFile(filePath);
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        console.log(`Client connected. Total: ${clients.size}`);
        
        // Send initial state
        const state = getDashboardState();
        ws.send(JSON.stringify({ type: "state", data: state }));
        
        // Send current output buffers
        for (const [windowNum, buffer] of outputBuffers.entries()) {
          ws.send(JSON.stringify({
            type: "output",
            window: windowNum,
            content: buffer.join("\n"),
            timestamp: new Date().toISOString(),
          }));
        }
        
        // Start streaming if first client
        if (clients.size === 1) {
          startStreaming();
        }
      },
      close(ws) {
        clients.delete(ws);
        console.log(`Client disconnected. Total: ${clients.size}`);
        
        // Stop streaming if no clients
        if (clients.size === 0) {
          stopStreaming();
        }
      },
      message(ws, message) {
        try {
          const data = JSON.parse(message as string);
          
          switch (data.type) {
            case "action":
              // Handle orchestrator actions
              handleAction(data.action, data.data);
              break;

            case "branch_action":
              // Handle branch/session actions
              handleBranchAction(data.action, data.data).then((result) => {
                ws.send(JSON.stringify({
                  type: "branch_result",
                  action: data.action,
                  ...result,
                }));
                // Broadcast updated state
                broadcastState();
              });
              break;

            case "keystrokes":
              // Send keystrokes to window
              if (data.window && data.keys) {
                const success = sendKeystrokes(data.window, data.keys);
                ws.send(JSON.stringify({
                  type: "ack",
                  action: "keystrokes",
                  window: data.window,
                  success,
                }));
              }
              break;
              
            case "prompt":
              // Send prompt to window
              if (data.window && data.content) {
                const success = sendPrompt(data.window, data.content);
                ws.send(JSON.stringify({
                  type: "ack",
                  action: "prompt",
                  window: data.window,
                  success,
                }));
              }
              break;
              
            case "focus":
              // Focus window
              if (data.window) {
                const success = focusWindow(data.window);
                ws.send(JSON.stringify({
                  type: "ack",
                  action: "focus",
                  window: data.window,
                  success,
                }));
              }
              break;
          }
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      },
    },
  });
  
  // Watch state file for changes
  const statePath = join(projectDir, WORKFLOW_DIR, "state.json");
  const signalsPath = join(projectDir, WORKFLOW_DIR, "signals");
  
  if (existsSync(statePath)) {
    watch(statePath, () => broadcastState());
  }
  
  if (existsSync(signalsPath)) {
    watch(signalsPath, () => broadcastState());
  }
  
  console.log(`\n🌐 Web dashboard running at http://localhost:${port}`);
  console.log(`📱 WebSocket endpoint: ws://localhost:${port}/ws`);
    console.log("\nPress Ctrl+C to stop\n");
  
  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stopping web server...");
    stopStreaming();
    server.stop();
    process.exit(0);
  });
  
  // Keep server running
  await new Promise(() => {});
}

// Handle orchestrator actions from browser
function handleAction(action: string, data?: Record<string, unknown>): void {
  // Handle special actions directly
  if (action === "export_session") {
    // Export both JSON and Markdown directly
    try {
      const jsonPath = exportToJSON();
      const mdPath = exportToMarkdown();
      console.log(`📤 Exported session: ${jsonPath}, ${mdPath}`);
      // Broadcast updated state
      broadcastState();
    } catch (error) {
      console.error("Export failed:", error);
    }
    return;
  }

  if (action === "clear_session") {
    // Clear workflow directly
    try {
      clearWorkflow();
      console.log("🧹 Session cleared");
      broadcastState();
    } catch (error) {
      console.error("Clear session failed:", error);
    }
    return;
  }

  // These trigger the same actions as keyboard shortcuts
  const actionMap: Record<string, string> = {
    dispatch_plan: "p",
    dispatch_review: "r",
    dispatch_refine: "f",
    dispatch_compound: "c",
    create_pr: "g",
    commit_checkpoint: "k",
    refresh_status: "s",
    new_feature: "n",
    branch_management: "b",
  };

  const key = actionMap[action];
  if (key) {
    sendKeystrokes(WINDOWS.orchestrator, key);
  }
}

// Handle branch actions from browser
async function handleBranchAction(action: string, data?: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
  switch (action) {
    case "save_session": {
      const branch = data?.branch as string || getCurrentBranch();
      try {
        saveSessionToBranch(branch);
        return { success: true, message: `Session saved for ${branch}` };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to save session" };
      }
    }

    case "load_session": {
      const branch = data?.branch as string;
      if (!branch) {
        return { success: false, message: "Branch name required" };
      }
      try {
        const loaded = loadSessionFromBranch(branch);
        if (loaded) {
          return { success: true, message: `Session loaded from ${branch}` };
        }
        return { success: false, message: `No saved session found for ${branch}` };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to load session" };
      }
    }

    case "list_sessions": {
      const sessions = listBranchSessions();
      return { success: true, message: `Found ${sessions.length} saved sessions` };
    }

    case "clear_session": {
      const branch = data?.branch as string;
      if (!branch) {
        return { success: false, message: "Branch name required" };
      }
      try {
        const cleared = clearBranchSession(branch);
        if (cleared) {
          return { success: true, message: `Session cleared for ${branch}` };
        }
        return { success: false, message: `No session found for ${branch}` };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : "Failed to clear session" };
      }
    }

    case "switch_branch": {
      const branch = data?.branch as string;
      if (!branch) {
        return { success: false, message: "Branch name required" };
      }

      // Save current session before switching
      const currentBranch = getCurrentBranch();
      try {
        saveSessionToBranch(currentBranch);
      } catch (error) {
        console.error("Failed to save current session:", error);
      }

      // Switch branch
      const result = switchBranch(branch);
      if (result.success) {
        // Try to load saved session
        const loaded = loadSessionFromBranch(branch);
        if (loaded) {
          return { success: true, message: `Switched to ${branch} and loaded session` };
        }
        return { success: true, message: `Switched to ${branch} (no saved session)` };
      }
      return { success: false, message: result.error || "Failed to switch branch" };
    }

    case "create_branch": {
      const template = data?.template as string || "compound";
      const name = data?.name as string;

      if (!name) {
        return { success: false, message: "Branch name required" };
      }

      const result = createBranchFromTemplate(template, name);
      if (result.success && result.branch) {
        return { success: true, message: `Created and switched to ${result.branch}` };
      }
      return { success: false, message: result.error || "Failed to create branch" };
    }

    default:
      return { success: false, message: `Unknown action: ${action}` };
  }
}
