import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/infrastructure/configuration/config.js";

const base = { DATABASE_URL: "postgres://app:placeholder@127.0.0.1/bbm" };
const originalCwd = process.cwd();
// <root>/apps/server/tests/unit -> <root>
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

function withBuiltClient<T>(work: (directory: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "bbm-dist-"));
  const directory = join(root, "apps", "client", "dist");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.html"), "<!doctype html>");
  try {
    return work(directory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLIENT_DIST resolves a repository-root-relative path from a nested working directory", () => {
  // The start script runs in apps/server, while the documented value
  // (apps/client/dist) is relative to the repository root.
  const serverWorkspace = join(repositoryRoot, "apps", "server");
  process.chdir(serverWorkspace);
  try {
    const config = loadConfig({
      ...base,
      CLIENT_DIST: join("apps", "client", "dist"),
    });
    assert.equal(
      config.clientDist,
      join(repositoryRoot, "apps", "client", "dist"),
    );
    assert.match(config.clientDist ?? "", /apps[\\/]client[\\/]dist$/);
  } finally {
    process.chdir(originalCwd);
  }
});

test("CLIENT_DIST accepts an absolute path and rejects a missing bundle", () => {
  withBuiltClient((directory) => {
    assert.equal(
      loadConfig({ ...base, CLIENT_DIST: directory }).clientDist,
      directory,
    );
    assert.throws(
      () => loadConfig({ ...base, CLIENT_DIST: join(directory, "missing") }),
      /built BBM client directory/,
    );
  });
});

test("CLIENT_DIST is optional and absent by default", () => {
  assert.equal(loadConfig({ ...base }).clientDist, undefined);
  assert.equal(
    loadConfig({ ...base, CLIENT_DIST: "   " }).clientDist,
    undefined,
  );
});
