import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  serverRoot,
  "src/infrastructure/persistence/postgres/migrations",
);
const target = resolve(
  serverRoot,
  "dist/infrastructure/persistence/postgres/migrations",
);
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true, force: true });
