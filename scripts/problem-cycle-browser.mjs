import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

export function bounded(promise, label, ms = 60_000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
  })]).finally(() => clearTimeout(timer));
}

// Event subscriptions are installed synchronously; history is usable only when
// the caller explicitly chooses an earlier cursor. No timer polls.
export class Events {
  rows = [];
  pending = new Set();
  mark() { return this.rows.length; }
  emit(value) {
    this.rows.push(value);
    for (const item of [...this.pending]) if (item.predicate(value)) {
      this.pending.delete(item); item.resolve(value);
    }
  }
  wait(predicate, label, from = this.mark(), ms = 60_000) {
    const prior = this.rows.slice(from).find(predicate);
    if (prior !== undefined) return Promise.resolve(prior);
    const deferred = Promise.withResolvers();
    const item = { ...deferred, predicate };
    this.pending.add(item);
    const result = bounded(deferred.promise, label, ms).finally(() => this.pending.delete(item));
    result.catch(() => {}); // an armed assertion may be awaited after its trigger RPC
    return result;
  }
}

export async function openBrowser({ executable, home, profile, headless = true }) {
  assert.ok(executable, "WEAVRA_CHROMIUM must name an owned browser");
  const output = new Events();
  const ready = output.wait((x) => /DevTools listening on (ws:\/\/\S+)/.test(x), "Chromium CDP ready");
  const child = spawn(executable, [
    ...(headless ? ["--headless=new"] : []), "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank",
  ], { env: { PATH: process.env.PATH, HOME: home, LANG: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  const exit = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; output.emit(stderr); });
  child.stdout.resume();
  const fatal = new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", () => reject(new Error("Chromium exited before CDP readiness")));
  });
  let socket;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ id: 0, method: "Browser.close" }));
      else child.kill("SIGTERM");
    }
    let forced = false;
    const receipt = await bounded(exit, "owned Chromium exit", 15_000).catch(async () => {
      forced = true;
      child.kill("SIGKILL");
      return bounded(exit, "owned Chromium forced exit", 10_000);
    });
    socket?.close();
    return { pid: child.pid, exited: true, forced, ...receipt };
  };
  try {
    const line = await Promise.race([ready, fatal]);
    socket = new WebSocket(line.match(/DevTools listening on (ws:\/\/\S+)/)[1]);
    await bounded(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }), "CDP socket open");
    let sequence = 0;
    const pending = new Map();
    const events = new Events();
    socket.addEventListener("close", () => {
      for (const d of pending.values()) d.reject(new Error("Owned CDP socket closed"));
      pending.clear();
    });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const d = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) d?.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
        else d?.resolve(message.result);
      } else events.emit(message);
    });
    const send = (method, params = {}, sessionId) => {
      const id = ++sequence, d = Promise.withResolvers();
      pending.set(id, d);
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return bounded(d.promise, `CDP ${method}`).finally(() => pending.delete(id));
    };
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined,
        result.exceptionDetails?.exception?.description?.split("\n")[0] ?? "Browser assertion failed");
      return result.result.value;
    };
    const arm = async (predicate) => {
      const id = `w8-${++sequence}`;
      await evaluate(`(() => {
        window.__w8 ??= new Map();
        let finish;
        const promise = new Promise(resolve => finish = resolve);
        const inspect = () => { if ((${predicate})()) { observer.disconnect(); finish(true); } };
        const observer = new MutationObserver(inspect);
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        window.__w8.set(${JSON.stringify(id)}, { promise, observer });
        inspect(); return true;
      })()`);
      return () => evaluate(`window.__w8.get(${JSON.stringify(id)}).promise`);
    };
    const waitText = async (text) => (await arm(`() => document.body?.innerText.includes(${JSON.stringify(text)})`))();
    const navigate = async (url) => {
      const loaded = events.wait((e) => e.method === "Page.loadEventFired" && e.sessionId === sessionId, "page loaded");
      await call("Page.navigate", { url });
      await loaded;
    };
    const click = async (text) => {
      assert.equal(await evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled);
        if (!b) return false; b.click(); return true;
      })()`), true, `Missing enabled button: ${text}`);
    };
    const clickAction = async (action) => {
      assert.equal(await evaluate(`(() => {
        const b = document.querySelector('button[data-weavra-action=' + JSON.stringify(${JSON.stringify(action)}) + ']');
        if (!b || b.disabled) return false; b.click(); return true;
      })()`), true, `Missing enabled action: ${action}`);
    };
    const press = async (name, modifiers = 0) => {
      const keys = {
        Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
        Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
        Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
      };
      const key = keys[name];
      assert.ok(key, "Unsupported QA key");
      await call("Input.dispatchKeyEvent", { type: "keyDown", ...key, modifiers,
        ...(name === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
      await call("Input.dispatchKeyEvent", { type: "keyUp", ...key, modifiers });
    };
    return { pid: child.pid, arm, evaluate, waitText, navigate, click, clickAction, press, stop,
      typeText: (text) => call("Input.insertText", { text }),
      setFiles: async (selector, files) => {
        const { root } = await call("DOM.getDocument");
        const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector });
        assert.ok(nodeId, "Owned file input must exist");
        await call("DOM.setFileInputFiles", { nodeId, files });
      },
      exceptions: () => events.rows.filter((event) => event.method === "Runtime.exceptionThrown")
        .map((event) => event.params.exceptionDetails.exception?.description?.split("\n")[0] ??
          event.params.exceptionDetails.text),
      viewport: async (width, height, deviceScaleFactor = 1) => {
        await call("Emulation.setTouchEmulationEnabled", { enabled: width < 600 });
        return call("Emulation.setDeviceMetricsOverride", {
          width, height, deviceScaleFactor, mobile: width < 600,
        });
      },
      screenshot: async (path) => {
        const image = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(path, Buffer.from(image.data, "base64"));
      },
    };
  } catch (error) { await stop(); throw error; }
}
