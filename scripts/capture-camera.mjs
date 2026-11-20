import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 9224;
const profile = join(tmpdir(), `bbm-camera-${process.pid}`);
const browser = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--window-size=1440,900",
    "http://127.0.0.1:5173/play",
  ],
  { stdio: "ignore" },
);

let socket;
try {
  let pages;
  for (let i = 0; i < 80; i += 1) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch {
      await delay(100);
    }
  }
  const page = pages?.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome did not expose a page target.");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const key = async (key, code, down) =>
    send("Input.dispatchKeyEvent", {
      type: down ? "keyDown" : "keyUp",
      key,
      code,
      windowsVirtualKeyCode:
        key === "ArrowRight" ? 39 : key === "ArrowLeft" ? 37 : 32,
      nativeVirtualKeyCode:
        key === "ArrowRight" ? 39 : key === "ArrowLeft" ? 37 : 32,
    });
  const screenshot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join("screenshots", name),
      Buffer.from(result.data, "base64"),
    );
  };

  await send("Page.enable");
  await delay(1000);
  await key("d", "KeyD", true);
  await delay(1800);
  await key("d", "KeyD", false);
  await screenshot("camera-track-right.png");
  await key("a", "KeyA", true);
  await delay(1600);
  await key("a", "KeyA", false);
  await screenshot("camera-reverse-left.png");
  await key(" ", "Space", true);
  await delay(120);
  await key(" ", "Space", false);
  await delay(400);
  await screenshot("camera-jump.png");
} finally {
  socket?.close();
  browser.kill();
}
