import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = "apps/server/src";
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? files(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}
const failures = [];
for (const path of files(join(root, "domain"))) {
  const source = readFileSync(path, "utf8");
  if (
    /from\s+['"](?:express|pg|ws|\.\.?\/.*(?:infrastructure|presentation))/.test(
      source,
    )
  )
    failures.push(`${path}: domain imports an outer dependency`);
}
for (const path of files(join(root, "application"))) {
  const source = readFileSync(path, "utf8");
  if (
    /from\s+['"](?:express|pg|ws|\.\.?\/.*(?:infrastructure|presentation))/.test(
      source,
    )
  )
    failures.push(
      `${path}: application imports a framework, driver, or outer layer`,
    );
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Architecture boundaries passed (documented source-scan coverage).",
  );
