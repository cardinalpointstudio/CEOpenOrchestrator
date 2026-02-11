#!/bin/bash
# CEOpenOrchestrator Tmux Session Setup
# Creates tmux session with all windows and launches workers

SESSION_NAME="opencode-ce"
PROJECT_DIR="${1:-$(pwd)}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo -e "${BLUE}   CEOpenOrchestrator - Starting Session      ${NC}"
echo -e "${BLUE}══════════════════════════════════════════════${NC}"
echo ""

# Check if session already exists
tmux has-session -t $SESSION_NAME 2>/dev/null
if [ $? == 0 ]; then
    echo -e "${YELLOW}Session '$SESSION_NAME' already exists. Attaching...${NC}"
    tmux attach -t $SESSION_NAME
    exit 0
fi

cd "$PROJECT_DIR" || {
    echo -e "${RED}Error: Could not cd to $PROJECT_DIR${NC}"
    exit 1
}

# Check for .workflow directory
if [ ! -d ".workflow" ]; then
    echo -e "${RED}Error: No .workflow/ directory found.${NC}"
    echo "Run 'ce-orchestrate init' first."
    exit 1
fi

echo -e "${BLUE}Creating tmux session with 7 windows...${NC}"

# Create session with Orchestrator window (window 1)
tmux new-session -d -s $SESSION_NAME -n "Orch" -c "$PROJECT_DIR"

# Create worker windows
tmux new-window -t $SESSION_NAME -n "PM" -c "$PROJECT_DIR"
tmux new-window -t $SESSION_NAME -n "Backend" -c "$PROJECT_DIR"
tmux new-window -t $SESSION_NAME -n "Frontend" -c "$PROJECT_DIR"
tmux new-window -t $SESSION_NAME -n "Tests" -c "$PROJECT_DIR"
tmux new-window -t $SESSION_NAME -n "Review" -c "$PROJECT_DIR"
tmux new-window -t $SESSION_NAME -n "Dashboard" -c "$PROJECT_DIR"

# Go back to Orch window
tmux select-window -t $SESSION_NAME:1

echo -e "${BLUE}Launching orchestrator and OpenCode...${NC}"

# Launch orchestrator in Window 1
tmux send-keys -t $SESSION_NAME:1 "echo -e '${BLUE}=== ORCHESTRATOR ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:1 "ce-orchestrate start-internal" C-m

# Launch OpenCode in other windows (they'll wait for tasks)
tmux send-keys -t $SESSION_NAME:2 "echo -e '${BLUE}=== PM (Project Manager) Window ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:2 "echo 'Describe your feature here when ready'" C-m
tmux send-keys -t $SESSION_NAME:2 "opencode" C-m

tmux send-keys -t $SESSION_NAME:3 "echo -e '${BLUE}=== BACKEND Worker ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:3 "echo 'Waiting for plan...'" C-m

tmux send-keys -t $SESSION_NAME:4 "echo -e '${BLUE}=== FRONTEND Worker ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:4 "echo 'Waiting for plan...'" C-m

tmux send-keys -t $SESSION_NAME:5 "echo -e '${BLUE}=== TESTS Worker ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:5 "echo 'Waiting for plan...'" C-m

tmux send-keys -t $SESSION_NAME:6 "echo -e '${BLUE}=== REVIEW Worker ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:6 "echo 'Waiting for implementation...'" C-m

tmux send-keys -t $SESSION_NAME:7 "echo -e '${BLUE}=== DASHBOARD Window ===${NC}'" C-m
tmux send-keys -t $SESSION_NAME:7 "ce-orchestrate dashboard" C-m

echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}   Session Ready!                             ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo "  Windows:"
echo "    1: Orch      - Orchestrator (command center)"
echo "    2: PM        - Project Manager (describe feature here)"
echo "    3: Backend   - Backend worker"
echo "    4: Frontend  - Frontend worker"
echo "    5: Tests     - Tests worker"
echo "    6: Review    - Reviewer"
echo "    7: Dashboard - Project Dashboard"
echo ""
echo "  Navigation: Ctrl+b then 1-7"
echo "  Detach:      Ctrl+b then d"
echo "  Re-attach:   tmux attach -t $SESSION_NAME"
echo ""
echo -e "${YELLOW}Attaching to session...${NC}"

tmux attach -t $SESSION_NAME
