/**
 * Worker prompt generation and dispatch
 */

import { execSync } from "node:child_process";
import type { Config, WorkerRole } from "./types.js";
import { WINDOWS, SESSION_NAME } from "./types.js";
import { getSignals } from "./state.js";

const WORKER_PROMPTS: Record<WorkerRole, string> = {
  planner: `You are the PLANNER worker for CEOpenOrchestrator.

## YOUR TASK
Create a comprehensive implementation plan for the feature described by the user.

## OUTPUT ARTIFACTS
Create these files in .workflow/:

1. PLAN.md - Overall strategy with:
   - Feature overview
   - Architecture decisions
   - Component breakdown
   - Dependencies and requirements

2. contracts/ - TypeScript interfaces:
   - API request/response types
   - Database models
   - Shared types between frontend and backend

3. tasks/ - Per-worker task files:
   - backend.md
   - frontend.md
   - tests.md

## PROCESS
1. Ask clarifying questions to understand requirements
2. Explore existing codebase for patterns
3. Design the solution
4. Create all artifacts
5. Wait for user approval

## COMPLETION
When the user approves the plan, create: .workflow/signals/plan.done

DO NOT proceed to implementation until explicitly approved.`,

  backend: `You are the BACKEND WORKER for CEOpenOrchestrator.

## YOUR TASK
Implement the backend functionality described in .workflow/tasks/backend.md

## SCOPE
Only modify files in these directories:
{backendScopes}

## CONTRACTS
Import types from: .workflow/contracts/

## CONSTRAINTS
- Follow existing code patterns in the codebase
- All new code must be type-safe
- Handle errors appropriately
- Write clean, maintainable code
- Do NOT write tests (tests worker handles that)
- Do NOT modify frontend files

## PROCESS
1. Read your task file: cat .workflow/tasks/backend.md
2. Read relevant contracts: cat .workflow/contracts/*.ts
3. Implement your tasks
4. Verify compilation: {typecheckCommand}
5. Signal completion

## COMPLETION
When done: touch .workflow/signals/backend.done

DO NOT modify files outside your scope.`,

  frontend: `You are the FRONTEND WORKER for CEOpenOrchestrator.

## YOUR TASK
Implement the frontend functionality described in .workflow/tasks/frontend.md

## SCOPE
Only modify files in these directories:
{frontendScopes}

## CONTRACTS
Import types from: .workflow/contracts/

## CONSTRAINTS
- Follow existing component patterns
- Use existing design system/UI library
- Ensure accessibility (aria labels, keyboard nav)
- Handle loading and error states
- Do NOT write tests (tests worker handles that)
- Do NOT modify backend files

## PROCESS
1. Read your task file: cat .workflow/tasks/frontend.md
2. Read relevant contracts: cat .workflow/contracts/*.ts
3. Implement your tasks
4. Verify compilation: {typecheckCommand}
5. Signal completion

## COMPLETION
When done: touch .workflow/signals/frontend.done

DO NOT modify files outside your scope.`,

  tests: `You are the TESTS WORKER for CEOpenOrchestrator.

## YOUR TASK
Write comprehensive tests as described in .workflow/tasks/tests.md

## SCOPE
Only modify test files in these patterns:
{testsScopes}

## CONTRACTS
Test against interfaces in: .workflow/contracts/

## CONSTRAINTS
- Write tests BEFORE checking if implementations exist (TDD style)
- Cover happy path + edge cases
- Mock external dependencies appropriately
- Tests should initially fail (implementations coming from other workers)
- Do NOT modify source files (src/) - only test files

## PROCESS
1. Read your task file: cat .workflow/tasks/tests.md
2. Read contracts to understand interfaces: cat .workflow/contracts/*.ts
3. Write comprehensive tests
4. Verify test syntax: {typecheckCommand}
5. Signal completion

## COMPLETION
When done: touch .workflow/signals/tests.done

Tests will fail until other workers complete - this is expected.`,

  reviewer: `You are the REVIEWER worker for CEOpenOrchestrator.

## YOUR TASK
Review all implementation work and provide comprehensive feedback.

## CHECKS TO PERFORM

1. **Automated Checks**
   - Run test suite: {testCommand}
   - Run type checking: {typecheckCommand}
   - Run linting: {lintCommand}

2. **Code Review**
   - Security (injection, auth bypass, XSS, etc.)
   - Performance (N+1 queries, unbounded operations, etc.)
   - Correctness (null handling, race conditions, error handling)
   - Maintainability (code duplication, magic values, etc.)

3. **Contract Validation**
   - Verify contracts are implemented correctly
   - Check type safety across boundaries

## OUTPUT
Create .workflow/REVIEW.md with:

\`\`\`markdown
## Status
STATUS: [PASS | PASS_WITH_WARNINGS | FAIL]

## Summary
Brief overview of what was implemented

## Automated Check Results
- Tests: [PASS/FAIL] (details)
- Type Check: [PASS/FAIL] (details)
- Lint: [PASS/FAIL] (details)

## Issues Found

### Critical (blocking)
- [ ] Issue description and location

### Warnings (non-blocking)
- [ ] Warning description

## Recommendations
- Suggestions for improvement
\`\`\`

## COMPLETION
When done: touch .workflow/signals/review.done`,
};

function formatScopes(scopes: string[]): string {
  return scopes.map(s => `  - ${s}`).join("\n");
}

function getCommandOrDefault(command: string | null, defaultCmd: string): string {
  return command || defaultCmd;
}

export function generateWorkerPrompt(role: WorkerRole, config: Config): string {
  let prompt = WORKER_PROMPTS[role];
  
  // Replace placeholders
  prompt = prompt.replace("{backendScopes}", formatScopes(config.scopes.backend));
  prompt = prompt.replace("{frontendScopes}", formatScopes(config.scopes.frontend));
  prompt = prompt.replace("{testsScopes}", formatScopes(config.scopes.tests));
  
  prompt = prompt.replace(
    "{testCommand}",
    getCommandOrDefault(config.commands.test, "bun test")
  );
  prompt = prompt.replace(
    "{typecheckCommand}",
    getCommandOrDefault(config.commands.typecheck, "bun run tsc --noEmit")
  );
  prompt = prompt.replace(
    "{lintCommand}",
    getCommandOrDefault(config.commands.lint, "bun run lint")
  );
  
  return prompt;
}

export function dispatchWorker(
  role: WorkerRole,
  window: number,
  config: Config,
  isRefine: boolean = false
): void {
  const prompt = generateWorkerPrompt(role, config);
  const phase = isRefine ? "REFINE" : "";
  
  // Add refine-specific instructions if applicable
  const finalPrompt = isRefine
    ? `${prompt}\n\n## REFINE MODE\nYou are in REFINE mode. Read .workflow/REVIEW.md and fix the issues in your domain.\nWhen done: touch .workflow/signals/${role}-refine.done`
    : `${prompt}\nWhen done: touch .workflow/signals/${role}.done`;

  // Escape the prompt for tmux
  const escaped = finalPrompt.replace(/'/g, "'\"'\"'");
  
  // Send to tmux window
  try {
    execSync(`tmux send-keys -t ${SESSION_NAME}:${window} 'opencode --prompt '${escaped}''`, {
      stdio: "ignore",
    });
    execSync(`tmux send-keys -t ${SESSION_NAME}:${window} Enter`, { stdio: "ignore" });
  } catch (e) {
    console.error(`Failed to dispatch worker ${role} to window ${window}:`, e);
  }
}

export function dispatchAllWorkers(config: Config, isRefine: boolean = false): void {
  const workers: WorkerRole[] = ["backend", "frontend", "tests"];
  const windows = [WINDOWS.backend, WINDOWS.frontend, WINDOWS.tests];
  
  // Stagger dispatch to avoid overwhelming the system
  workers.forEach((role, index) => {
    setTimeout(() => {
      dispatchWorker(role, windows[index], config, isRefine);
    }, index * 300);
  });
}

export function dispatchReviewer(config: Config): void {
  dispatchWorker("reviewer", WINDOWS.reviewer, config);
}

export function clearWorkerWindow(window: number): void {
  try {
    // Send Ctrl+C to cancel any pending input
    execSync(`tmux send-keys -t ${SESSION_NAME}:${window} C-c`, { stdio: "ignore" });
    
    // Small delay
    setTimeout(() => {
      try {
        // Send clear command
        execSync(`tmux send-keys -t ${SESSION_NAME}:${window} 'clear' Enter`, {
          stdio: "ignore",
        });
      } catch {
        // Ignore errors
      }
    }, 100);
  } catch {
    // Ignore errors
  }
}

export function clearAllWorkers(): void {
  const windows = [WINDOWS.planner, WINDOWS.backend, WINDOWS.frontend, WINDOWS.tests, WINDOWS.reviewer];
  windows.forEach((window, index) => {
    setTimeout(() => clearWorkerWindow(window), index * 100);
  });
}

export function getWorkerStatus(role: WorkerRole): "idle" | "working" | "done" {
  // This is a simplified check - in reality, we'd need more sophisticated detection
  // For now, we rely on signal files
  const signals = getSignals();
  
  if (signals[role] || signals[`${role}-refine`]) {
    return "done";
  }
  
  // We can't easily detect "working" vs "idle" without querying tmux
  // For now, return idle as default
  return "idle";
}
