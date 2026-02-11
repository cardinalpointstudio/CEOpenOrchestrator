#!/bin/bash
# CEOpenOrchestrator Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/[user]/CEOpenOrchestrator/main/install.sh | bash

set -e

REPO_URL="https://github.com/[user]/CEOpenOrchestrator"
INSTALL_DIR="$HOME/.local/share/ce-open-orchestrator"
BIN_DIR="$HOME/.local/bin"

echo "⚡ Installing CEOpenOrchestrator..."

# Check for required dependencies
check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ $1 is not installed"
        return 1
    fi
    echo "✓ $1 found"
    return 0
}

echo ""
echo "Checking dependencies..."

# Check for Bun
if ! check_dependency "bun"; then
    echo ""
    echo "Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Check for tmux
if ! check_dependency "tmux"; then
    echo ""
    echo "❌ tmux is required but not installed"
    echo "Please install tmux first:"
    echo "  Ubuntu/Debian: sudo apt-get install tmux"
    echo "  macOS: brew install tmux"
    echo "  Arch: sudo pacman -S tmux"
    exit 1
fi

# Check for opencode
if ! check_dependency "opencode"; then
    echo ""
    echo "❌ opencode is required but not installed"
    echo "Please install opencode:"
    echo "  curl -fsSL https://opencode.ai/install | bash"
    exit 1
fi

# Check for git
if ! check_dependency "git"; then
    echo "❌ git is required but not installed"
    exit 1
fi

# Optional: Check for GitHub CLI
if ! check_dependency "gh"; then
    echo "⚠️  GitHub CLI (gh) not found - PR creation will not work"
    echo "   Install from: https://cli.github.com"
fi

echo ""
echo "Installing CEOpenOrchestrator..."

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

# Clone or update repository
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    echo "Cloning repository..."
    git clone "$REPO_URL.git" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo "Installing dependencies..."
bun install

# Build project
echo "Building..."
bun run build

# Create symlink
echo "Creating symlink..."
ln -sf "$INSTALL_DIR/scripts/ce-orchestrate" "$BIN_DIR/ce-orchestrate"

# Add to PATH if needed
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo "⚠️  $BIN_DIR is not in your PATH"
    echo "Add this to your shell profile (.bashrc, .zshrc, etc.):"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Get started:"
echo "  1. Navigate to your project: cd /path/to/project"
echo "  2. Initialize: ce-orchestrate init"
echo "  3. Start: ce-orchestrate start"
echo ""
echo "Documentation: https://github.com/[user]/CEOpenOrchestrator#readme"
