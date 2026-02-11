# CEOpenOrchestrator

Parallel workflow orchestration for OpenCode - implementing the Compound Engineering methodology.

## Overview

CEOpenOrchestrator enables multiple AI agents to work simultaneously on different aspects of a software project, following the principle: **80% planning/review, 20% execution**.

It spins up a tmux session with specialized workers:
- **Planner**: Designs architecture and creates implementation plan
- **Backend**: Implements API, database, and server logic
- **Frontend**: Implements UI components and user interactions
- **Tests**: Writes comprehensive test suites
- **Reviewer**: Validates all work through automated checks and code review

## Features

- 🤖 **Parallel Development**: Run 5 AI agents simultaneously
- 🎯 **Quality Gates**: Multi-agent review with PASS/FAIL/PASS_WITH_WARNINGS
- 🔄 **Iterative Refinement**: Automatic refine cycles for failed reviews
- 📝 **Auto-Documentation**: Compounds learnings from each session
- ⚡ **Zero-Config**: Auto-detects project structure and test commands
- 🎛️ **Configurable**: Per-project and global configuration support
- 🖥️ **Interactive TUI**: Real-time status with keyboard controls
- 🌐 **Optional Web UI**: Browser dashboard (coming soon)

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/cardinalpointstudio/CEOpenOrchestrator/main/install.sh | bash
```

### Requirements

- [Bun](https://bun.sh) runtime
- [tmux](https://github.com/tmux/tmux)
- [OpenCode](https://opencode.ai) CLI
- Git
- GitHub CLI (optional, for PR creation)

### Manual Install

```bash
git clone https://github.com/cardinalpointstudio/CEOpenOrchestrator.git
cd CEOpenOrchestrator
bun install
bun run build

# Add to PATH
ln -s $(pwd)/scripts/ce-orchestrate ~/.local/bin/ce-orchestrate
```

## Quick Start

```bash
# Navigate to your project
cd ~/my-project

# Initialize CEOpenOrchestrator
ce-orchestrate init

# Start orchestration session
ce-orchestrate start
```

## Usage

### Workflow

```
INIT → PLANNING → IMPLEMENTING → REVIEWING → REFINING → COMPOUNDING → COMPLETE
                ↑                                      ↓
                └──────────────────────────────────────┘
                     (max 3 iterations)
```

### Windows

| Window | Role | Purpose |
|--------|------|---------|
| 1 | **Orchestrator** | Interactive command center |
| 2 | **Planner** | Creates PLAN.md and architecture |
| 3 | **Backend** | Implements API and server code |
| 4 | **Frontend** | Implements UI components |
| 5 | **Tests** | Writes test suites |
| 6 | **Reviewer** | Validates all work |
| 7 | **Dashboard** | Status monitor |

### Keyboard Controls

| Key | Action |
|-----|--------|
| `P` | Approve plan, dispatch workers |
| `R` | Dispatch review |
| `F` | Dispatch refine (after review FAIL) |
| `C` | Dispatch compound (after review PASS) |
| `G` | Push & create PR |
| `K` | Manual commit checkpoint |
| `S` | Refresh status |
| `N` | New feature (clear workflow) |
| `Q` | Quit |

### Tmux Navigation

```
Ctrl+b 1  → Orchestrator (command center)
Ctrl+b 2  → Plan window (architect)
Ctrl+b 3  → Backend window
Ctrl+b 4  → Frontend window
Ctrl+b 5  → Tests window
Ctrl+b 6  → Review window
Ctrl+b 7  → Dashboard
Ctrl+b d  → Detach (session keeps running)
```

Re-attach: `tmux attach -t opencode-ce`

## Configuration

Configuration follows precedence:
1. Built-in defaults
2. Global config: `~/.config/ce-open-orchestrator/config.json`
3. Project config: `./.workflow/ce-config.json`

### Example Configuration

```json
{
  "models": {
    "planner": "kimi-k2.5-free",
    "backend": "kimi-k2.5-free",
    "frontend": "kimi-k2.5-free",
    "tests": "kimi-k2.5-free",
    "reviewer": "kimi-k2.5-free"
  },
  "timeouts": {
    "planner": 30,
    "backend": 30,
    "frontend": 30,
    "tests": 30,
    "reviewer": 30
  },
  "scopes": {
    "backend": ["src/api/**", "src/lib/**"],
    "frontend": ["src/components/**", "src/app/**"],
    "tests": ["**/*.test.ts"]
  },
  "commands": {
    "test": "bun test",
    "lint": "biome check .",
    "typecheck": "tsc --noEmit"
  },
  "keybindings": {
    "dispatch_plan": "p",
    "dispatch_review": "r",
    "dispatch_refine": "f",
    "dispatch_compound": "c",
    "create_pr": "g",
    "commit_checkpoint": "k",
    "refresh_status": "s",
    "new_feature": "n",
    "quit": "q"
  }
}
```

## Workflow Directory

```
.workflow/
├── PLAN.md              # Feature plan (created by Planner)
├── REVIEW.md            # Review results (created by Reviewer)
├── ce-config.json       # Project configuration
├── contracts/           # TypeScript interfaces
│   └── types.ts
├── tasks/               # Worker task files
│   ├── backend.md
│   ├── frontend.md
│   └── tests.md
├── signals/             # Coordination signals
│   ├── plan.done
│   ├── backend.done
│   ├── frontend.done
│   ├── tests.done
│   ├── review.done
│   └── compound.done
├── errors/              # Error logs
│   └── backend-2026-02-10T14-30-00.json
└── state.json           # Current workflow state
```

**Note:** `.workflow/` is excluded from git commits via `.gitignore`.

## Review Status

### PASS
All checks pass. Proceed to compounding.

### PASS_WITH_WARNINGS
Minor issues found (style, documentation, etc.). Non-blocking. Proceed to compounding with warnings logged.

### FAIL
Critical issues found (security, functionality, tests failing). Must enter refine phase. Max 3 iterations before escalating to user.

## Auto-Detection

CEOpenOrchestrator automatically detects:

- **Framework**: Next.js, React, Express, Hono, Vue, Svelte, Django, Rails, Rust, Go
- **Test Command**: Vitest, Jest, Mocha, Playwright, Cypress
- **Linter**: Biome, ESLint, Prettier
- **Type Checker**: TypeScript

## Commands

```bash
ce-orchestrate init          # Initialize project
ce-orchestrate start         # Start orchestration session
ce-orchestrate status        # Show current status
ce-orchestrate reset         # Reset workflow state
ce-orchestrate signal <name> # Manually create signal
ce-orchestrate config        # Show current configuration
ce-orchestrate --help        # Show help
```

## Development

```bash
# Clone repository
git clone https://github.com/cardinalpointstudio/CEOpenOrchestrator.git
cd CEOpenOrchestrator

# Install dependencies
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              TMUX SESSION: "opencode-ce"                   │
├─────────────────────────────────────────────────────────────┤
│  Window 1: Orchestrator (Interactive TUI)                  │
│  Window 2: Planner (opencode --prompt "...")               │
│  Window 3: Backend Worker                                  │
│  Window 4: Frontend Worker                                 │
│  Window 5: Tests Worker                                    │
│  Window 6: Reviewer Worker                                 │
│  Window 7: Dashboard (filesystem polling)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Browser View    │  (optional)
                    │  localhost:PORT  │
                    └──────────────────┘
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file.

## Acknowledgments

- Inspired by [CEOrchestrator](https://github.com/cardinalpointstudio/CEOrchestrator) for Claude Code
- Built for [OpenCode](https://opencode.ai)
- Follows Compound Engineering methodology

## Support

- 📖 [Documentation](https://github.com/cardinalpointstudio/CEOpenOrchestrator/wiki)
- 🐛 [Issue Tracker](https://github.com/cardinalpointstudio/CEOpenOrchestrator/issues)
- 💬 [Discussions](https://github.com/cardinalpointstudio/CEOpenOrchestrator/discussions)

---

Built with ⚡ by the CEOpenOrchestrator team
