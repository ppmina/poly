import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLCHAINS = [
  {
    concern: "formatter",
    approved: "oxfmt",
    alternatives: ["prettier", "@biomejs/biome", "dprint", "rome"],
  },
  {
    concern: "linter",
    approved: "oxlint",
    alternatives: ["eslint", "@eslint/js", "tslint", "@biomejs/biome", "rome"],
  },
  {
    concern: "test runner",
    approved: "vitest",
    alternatives: ["jest", "mocha", "ava", "tap", "uvu"],
  },
  {
    concern: "TypeScript compiler",
    approved: "typescript",
    alternatives: [],
  },
];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootManifestPath = path.join(rootDir, "package.json");
const workspaceRoots = ["apps", "packages"].map((segment) => path.join(rootDir, segment));

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(manifestPath) {
  const source = await readFile(manifestPath, "utf8");
  return JSON.parse(source);
}

async function listWorkspaceManifestPaths() {
  const manifests = [];

  for (const workspaceRoot of workspaceRoots) {
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(workspaceRoot, entry.name, "package.json");
      if (await fileExists(manifestPath)) {
        manifests.push(manifestPath);
      }
    }
  }

  return manifests.sort();
}

function findDependencyField(manifest, dependencyName) {
  for (const field of DEPENDENCY_FIELDS) {
    if (manifest[field]?.[dependencyName]) {
      return field;
    }
  }

  return null;
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath) || ".";
}

async function main() {
  const errors = [];
  const rootManifest = await loadManifest(rootManifestPath);
  const workspaceManifestPaths = await listWorkspaceManifestPaths();

  for (const tool of TOOLCHAINS) {
    const rootField = findDependencyField(rootManifest, tool.approved);
    if (!rootField) {
      errors.push(
        `[${relativePath(rootManifestPath)}] Missing root-owned ${tool.concern} dependency "${tool.approved}".`,
      );
    }

    for (const alternative of tool.alternatives) {
      const alternativeField = findDependencyField(rootManifest, alternative);
      if (alternativeField) {
        errors.push(
          `[${relativePath(rootManifestPath)}] Remove competing ${tool.concern} dependency "${alternative}" from ${alternativeField}; the repo standard is "${tool.approved}".`,
        );
      }
    }
  }

  for (const manifestPath of workspaceManifestPaths) {
    const manifest = await loadManifest(manifestPath);

    for (const tool of TOOLCHAINS) {
      const duplicateField = findDependencyField(manifest, tool.approved);
      if (duplicateField) {
        errors.push(
          `[${relativePath(manifestPath)}] Remove workspace-level ${tool.concern} dependency "${tool.approved}" from ${duplicateField}; the root package owns this toolchain.`,
        );
      }

      for (const alternative of tool.alternatives) {
        const alternativeField = findDependencyField(manifest, alternative);
        if (alternativeField) {
          errors.push(
            `[${relativePath(manifestPath)}] Remove competing ${tool.concern} dependency "${alternative}" from ${alternativeField}; the repo standard is "${tool.approved}".`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("Shared toolchain guard failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Shared toolchain guard passed: root owns formatter, linter, test runner, and TypeScript compiler dependencies.",
  );
}

await main();
