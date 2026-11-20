import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/presentation/http/app.js";
import { HealthService } from "../../src/application/services/health-service.js";

const clientDist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../client/dist",
);
const clientBuilt = existsSync(join(clientDist, "index.html"));

/** Serves the real Vite bundle when it exists, otherwise a minimal stand-in. */
function bundleDirectory(): string {
  if (clientBuilt) return clientDist;
  const root = mkdtempSync(join(tmpdir(), "bbm-client-"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><title>BBM test</title>",
  );
  writeFileSync(
    join(root, "play.html"),
    "<!doctype html><title>BBM play</title>",
  );
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "app.js"), "export const app = 1;\n");
  return root;
}

async function withHostedServer<T>(
  work: (base: string, port: number) => Promise<T>,
  clientDirectory = bundleDirectory(),
): Promise<T> {
  const server = createServer(
    createApp({
      health: new HealthService(null),
      port: 3000,
      clientDist: clientDirectory,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await work(`http://127.0.0.1:${address.port}`, address.port);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

test("hosted server serves the lobby page from its own port", async () => {
  await withHostedServer(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(
      await response.text(),
      /<script type="module" crossorigin src="\.\/assets\//,
    );
  });
});

test("hosted server serves the current HTML after the client bundle is rebuilt", async () => {
  const root = mkdtempSync(join(tmpdir(), "bbm-rebuilt-client-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><script type="module" src="./assets/main-oldhash.js"></script>',
  );
  writeFileSync(join(root, "assets", "main-oldhash.js"), "old bundle");

  try {
    await withHostedServer(async (base) => {
      const firstPage = await fetch(`${base}/`);
      assert.match(await firstPage.text(), /main-oldhash\.js/);

      writeFileSync(
        join(root, "index.html"),
        '<!doctype html><script type="module" src="./assets/main-newhash.js"></script>',
      );
      writeFileSync(join(root, "assets", "main-newhash.js"), "new bundle");

      const rebuiltPage = await fetch(`${base}/`);
      assert.match(await rebuiltPage.text(), /main-newhash\.js/);
      assert.equal((await fetch(`${base}/assets/main-newhash.js`)).status, 200);
    }, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hosted server serves the solo page and its static assets", async () => {
  await withHostedServer(async (base) => {
    const page = await fetch(`${base}/play.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const script = (await page.text()).match(/src="\.\/(assets\/[^"]+\.js)"/);
    assert.ok(script?.[1], "play page must reference hashed assets relatively");
    const asset = await fetch(`${base}/${script[1]}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
  });
});

test("hosted server keeps API routes ahead of the static bundle", async () => {
  await withHostedServer(async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "bbm-api" });
    const lan = await fetch(`${base}/api/lan-info`);
    assert.equal(lan.status, 200);
    assert.equal(
      ((await lan.json()) as { clientServed: boolean }).clientServed,
      true,
    );
    // Unknown API paths keep Express's JSON 404 instead of becoming the SPA page.
    const unknownApi = await fetch(`${base}/api/does-not-exist`);
    assert.equal(unknownApi.status, 404);
    assert.match(unknownApi.headers.get("content-type") ?? "", /text|json/);
    assert.equal((await unknownApi.text()).includes("<script"), false);
  });
});

test("hosted server does not serve files outside the bundle", async () => {
  await withHostedServer(async (base) => {
    const traversal = await fetch(`${base}/..%2F..%2Fpackage.json`);
    const body = await traversal.text();
    assert.equal(body.includes('"devDependencies"'), false);
    const encoded = await fetch(`${base}/assets/%2e%2e/%2e%2e/package.json`);
    assert.equal((await encoded.text()).includes('"devDependencies"'), false);
  });
});

test("hosted server rejects writes to static paths", async () => {
  await withHostedServer(async (base) => {
    const response = await fetch(`${base}/`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });
});

test("a same-origin browser client on the server port passes HTTP origin checks", async () => {
  await withHostedServer(async (base, port) => {
    const api = await fetch(`${base}/api/health`, {
      headers: { Origin: "http://evil.example:3000" },
    });
    assert.equal(api.status, 403);
    const sameOrigin = await fetch(`${base}/api/health`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(sameOrigin.status, 200);
    assert.equal(
      sameOrigin.headers.get("access-control-allow-origin"),
      `http://127.0.0.1:${port}`,
    );
  });
});
