/**
 * Project framework and command auto-detection
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { FrameworkTemplate, ScopesConfig, CommandsConfig } from "./types.js";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function loadPackageJson(): PackageJson | null {
  const path = join(process.cwd(), "package.json");
  if (!existsSync(path)) return null;
  
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
  } catch {
    return null;
  }
}

function hasDependency(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function hasScript(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return !!pkg.scripts?.[name];
}

export function detectFramework(): string {
  const pkg = loadPackageJson();
  
  if (pkg) {
    // Next.js
    if (hasDependency(pkg, "next")) return "nextjs";
    
    // React (but not Next.js)
    if (hasDependency(pkg, "react") && !hasDependency(pkg, "next")) return "react";
    
    // Express
    if (hasDependency(pkg, "express")) return "express";
    
    // Fastify
    if (hasDependency(pkg, "fastify")) return "fastify";
    
    // Hono
    if (hasDependency(pkg, "hono")) return "hono";
    
    // Vue
    if (hasDependency(pkg, "vue")) return "vue";
    
    // Svelte
    if (hasDependency(pkg, "svelte")) return "svelte";
    
    // Django
    if (existsSync("requirements.txt")) {
      const req = readFileSync("requirements.txt", "utf-8");
      if (req.includes("django")) return "django";
      if (req.includes("flask")) return "flask";
      if (req.includes("fastapi")) return "fastapi";
    }
  }
  
  // Rust
  if (existsSync("Cargo.toml")) return "rust";
  
  // Go
  if (existsSync("go.mod")) return "go";
  
  // Ruby on Rails
  if (existsSync("Gemfile")) {
    const gemfile = readFileSync("Gemfile", "utf-8");
    if (gemfile.includes("rails")) return "rails";
  }
  
  // Unknown
  return "unknown";
}

function getFrameworkScopes(framework: string): ScopesConfig {
  const scopes: Record<string, ScopesConfig> = {
    nextjs: {
      backend: ["src/app/api/**", "src/lib/**", "prisma/**", "src/server/**"],
      frontend: ["src/app/**", "src/components/**", "!src/app/api/**"],
      tests: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "__tests__/**"],
    },
    react: {
      backend: ["src/api/**", "src/server/**", "src/services/**"],
      frontend: ["src/components/**", "src/pages/**", "src/App.tsx", "src/main.tsx"],
      tests: ["**/*.test.ts", "**/*.test.tsx", "src/**/__tests__/**"],
    },
    express: {
      backend: ["src/routes/**", "src/models/**", "src/middleware/**", "src/controllers/**"],
      frontend: [],
      tests: ["tests/**", "**/*.test.js", "**/*.spec.js"],
    },
    hono: {
      backend: ["src/routes/**", "src/handlers/**", "src/middleware/**"],
      frontend: [],
      tests: ["tests/**", "**/*.test.ts"],
    },
    vue: {
      backend: ["src/api/**", "src/server/**"],
      frontend: ["src/components/**", "src/views/**", "src/App.vue"],
      tests: ["tests/**", "**/*.spec.js", "**/*.test.js"],
    },
    svelte: {
      backend: ["src/api/**", "src/server/**"],
      frontend: ["src/lib/**", "src/routes/**", "src/app.html"],
      tests: ["tests/**", "**/*.test.ts", "**/*.spec.ts"],
    },
    rust: {
      backend: ["src/**"],
      frontend: [],
      tests: ["tests/**", "src/**/*.rs"],
    },
    go: {
      backend: ["*.go", "cmd/**", "pkg/**", "internal/**"],
      frontend: [],
      tests: ["**/*_test.go"],
    },
    django: {
      backend: ["*/views.py", "*/models.py", "*/urls.py", "*/forms.py"],
      frontend: ["templates/**", "static/**"],
      tests: ["*/tests.py", "tests/**"],
    },
    rails: {
      backend: ["app/models/**", "app/controllers/**", "app/services/**", "config/routes.rb"],
      frontend: ["app/views/**", "app/assets/**"],
      tests: ["test/**", "spec/**"],
    },
    unknown: {
      backend: ["src/**", "lib/**", "server/**"],
      frontend: ["src/**", "client/**", "ui/**"],
      tests: ["tests/**", "test/**", "**/*.test.*", "**/*.spec.*"],
    },
  };
  
  return scopes[framework] || scopes.unknown;
}

function detectTestCommand(pkg: PackageJson | null): string | null {
  if (!pkg) return null;
  
  const scripts = pkg.scripts || {};
  
  // Direct test script
  if (scripts.test) return scripts.test;
  
  // Check for common test runners
  if (hasDependency(pkg, "vitest")) return "vitest";
  if (hasDependency(pkg, "jest")) return "jest";
  if (hasDependency(pkg, "mocha")) return "mocha";
  if (hasDependency(pkg, "tap")) return "tap";
  if (hasDependency(pkg, "ava")) return "ava";
  if (hasDependency(pkg, "playwright")) return "playwright test";
  if (hasDependency(pkg, "cypress")) return "cypress run";
  
  // Fallback
  if (existsSync("package.json")) return "bun test";
  
  return null;
}

function detectLintCommand(pkg: PackageJson | null): string | null {
  if (!pkg) return null;
  
  const scripts = pkg.scripts || {};
  
  // Check for lint scripts
  if (scripts.lint) return scripts.lint;
  if (scripts["lint:check"]) return scripts["lint:check"];
  if (scripts["check:lint"]) return scripts["check:lint"];
  if (scripts.eslint) return scripts.eslint;
  
  // Check for installed linters
  if (hasDependency(pkg, "biome")) return "biome check .";
  if (hasDependency(pkg, "eslint")) return "eslint .";
  if (hasDependency(pkg, "prettier")) return "prettier --check .";
  if (hasDependency(pkg, "standard")) return "standard";
  if (hasDependency(pkg, "xo")) return "xo";
  
  return null;
}

function detectTypecheckCommand(pkg: PackageJson | null): string | null {
  if (!pkg) return null;
  
  const scripts = pkg.scripts || {};
  
  // Check for typecheck scripts
  if (scripts.typecheck) return scripts.typecheck;
  if (scripts["check:types"]) return scripts["check:types"];
  if (scripts["tsc"]) return scripts.tsc;
  
  // Check for TypeScript
  if (hasDependency(pkg, "typescript")) return "tsc --noEmit";
  
  return null;
}

export function detectCommands(): CommandsConfig {
  const pkg = loadPackageJson();
  
  return {
    test: detectTestCommand(pkg),
    lint: detectLintCommand(pkg),
    typecheck: detectTypecheckCommand(pkg),
  };
}

export function generateConfig(framework: string): {
  scopes: ScopesConfig;
  commands: CommandsConfig;
} {
  return {
    scopes: getFrameworkScopes(framework),
    commands: detectCommands(),
  };
}

export function analyzeProject(): {
  framework: string;
  scopes: ScopesConfig;
  commands: CommandsConfig;
} {
  const framework = detectFramework();
  const { scopes, commands } = generateConfig(framework);
  
  return {
    framework,
    scopes,
    commands,
  };
}

export function formatConfigForDisplay(config: {
  scopes: ScopesConfig;
  commands: CommandsConfig;
}): string {
  return JSON.stringify({
    scopes: config.scopes,
    commands: config.commands,
  }, null, 2);
}
