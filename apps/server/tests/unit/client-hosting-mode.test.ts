import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../client/src/lobby/mount-lobby.ts",
  ),
  "utf8",
);

/** Source of the function starting at `name(`, up to its closing brace. */
function extract(name: string): string {
  const start = source.indexOf(`${name}(`);
  assert.ok(start >= 0, `${name} must exist in the lobby`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} has unbalanced braces`);
}

test("served-by-API detection requires JSON from /api/lan-info, not any HTML 200", () => {
  const fn = extract("async function servedOrigin");
  // A static host (Vite, a web server) answers every path with HTML, so only a
  // valid LAN-info JSON body may mark this page as served by the BBM API.
  assert.match(fn, /fetch\("\/api\/lan-info"/);
  assert.match(fn, /isLanInfo\(body\)/);
  assert.match(fn, /return null;/);
  assert.doesNotMatch(fn, /3000/);
});

test("the lobby offers one-click hosting and hides manual server entry", () => {
  // Hosting is a single action on the host computer, not .env editing or typing
  // an address. Manual address entry only remains for joining another computer.
  assert.match(source, /id="start-hosting"/);
  assert.match(source, /\/api\/hosting/);
  assert.match(source, /method: "POST"/);
  // Manual address entry only exists inside the collapsed advanced section.
  const advancedStart = source.indexOf('class="advanced"');
  assert.ok(advancedStart >= 0, "advanced section exists");
  const advanced = source.slice(advancedStart, source.indexOf("</details>"));
  assert.match(advanced, /id="server-form"/);
  assert.equal(source.indexOf('id="server-form"') > advancedStart, true);
});

test("responses are parsed safely so an empty body never surfaces as a JSON error", () => {
  const fn = extract("async function readApiResponse");
  assert.match(fn, /await response\.text\(\)/);
  assert.match(fn, /text\.trim\(\) === ""/);
  assert.match(fn, /without a response body/);
  assert.doesNotMatch(
    source,
    /const \w+(: unknown)? = await (response|\w+Response)\.json\(\)/,
    "no request may call .json() without checking the body",
  );
});

test("a chosen server address always wins over the stored one", () => {
  const resolveFn = extract("async function resolveInitialServer");
  // Served by the API => that origin is used, regardless of localStorage.
  assert.match(resolveFn, /if \(served\) \{\s*activeApiBaseUrl = served;/);
  // Not served by the API => the remembered/selected server is kept.
  assert.match(
    source,
    /let activeApiBaseUrl = safeServerStorageGet\(\) \?\? apiBaseUrl\(\);/,
  );
  assert.match(
    resolveFn,
    /const initialServer = serverAddressParts\(activeApiBaseUrl\);/,
  );
});

test("dev ports are recognised as a non-API page", () => {
  const fn = extract("function isDevServerPage");
  assert.match(fn, /DEV_PORTS\.includes/);
  const portsStart = source.indexOf("const DEV_PORTS");
  const ports = source.slice(portsStart, source.indexOf("];", portsStart));
  for (const port of [5173, 5174, 5180])
    assert.ok(ports.includes(String(port)));
});

test("the guest form only blocks dev-hosted pages when the selected API is unavailable", () => {
  const submitHandler = source.slice(
    source.indexOf('form.addEventListener("submit"'),
    source.indexOf('serverHostInput.addEventListener("focus"'),
  );
  assert.match(submitHandler, /isDevServerPage\(\)/);
  assert.match(submitHandler, /isBbmServer\(activeApiBaseUrl\)/);
});
