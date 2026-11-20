import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

export function loadWorkspaceEnv() {
  const envPath = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ].find(existsSync);
  if (envPath) dotenv.config({ path: envPath });
}
