import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [mode, trace, marker] = process.argv.slice(2);
const log = (value) => appendFileSync(trace, `${JSON.stringify({ pid: process.pid, ...value })}\n`);
log({ event: "start", credentialsFiltered: process.env.WEAVRA_TEST_SECRET === undefined && process.env.HOME === undefined });
const send = (value) => {
  const body = Buffer.from(JSON.stringify(value));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};
if (mode === "child") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  if (mode === "ignore-shutdown") process.on("SIGTERM", () => {});
  let root;
  let opened;
  let buffer = Buffer.alloc(0);
  let length;
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
  const diagnostic = (line, message = "type error 汉字\u001b\u202e") => ({ range: { start: { line, character: 0 }, end: { line, character: 3 } }, severity: 1, message, source: "fake", code: 2322 });
  const reply = (request, result) => send({ jsonrpc: "2.0", id: request.id, result });
  const handle = (request) => {
    log({ event: request.method ?? "client-response", position: request.params?.position, applied: request.result?.applied, errorCode: request.error?.code });
    if (request.method === "initialize") {
      root = fileURLToPath(request.params.rootUri);
      log({ event: "capabilities", mutationDisabled: request.params.capabilities.workspace.applyEdit === false, positionEncodings: request.params.capabilities.general.positionEncodings });
      if (mode === "init-timeout") return;
      if (mode === "bad-length") { process.stdout.write("Content-Length: nope\r\n\r\n{}"); return; }
      if (mode === "oversize") { process.stdout.write("Content-Length: 99999999\r\n\r\n"); return; }
      if (mode === "bad-json") { process.stdout.write("Content-Length: 1\r\n\r\n{"); return; }
      if (mode === "bad-error") { send({ jsonrpc: "2.0", id: request.id, error: null }); return; }
      if (mode === "bad-method") { send({ jsonrpc: "2.0", id: request.id, method: 42, result: null }); return; }
      reply(request, { capabilities: { positionEncoding: mode === "utf8" ? "utf-8" : "utf-16", textDocumentSync: 1, definitionProvider: true, referencesProvider: true, documentSymbolProvider: true, ...(mode.startsWith("push") ? {} : { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } }) } });
    } else if (request.method === "textDocument/didOpen") {
      opened = request.params.textDocument;
      log({ event: "document", uri: opened.uri, version: opened.version, text: opened.text });
      if (mode.startsWith("push") && mode !== "push-none") send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: opened.uri, version: mode === "push-stale" ? opened.version - 1 : opened.version, diagnostics: mode === "push-empty" ? [] : [diagnostic(0)] } });
    } else if (request.method === "shutdown") {
      if (mode !== "ignore-shutdown") reply(request, null);
    } else if (request.method === "exit") {
      if (mode !== "ignore-shutdown") process.exit(0);
    } else if (["textDocument/diagnostic", "textDocument/definition", "textDocument/references", "textDocument/documentSymbol"].includes(request.method)) {
      if (mode === "request-timeout") return;
      if (mode === "closed-once" && !existsSync(marker)) {
        writeFileSync(marker, "closed"); process.stdout.end(); setInterval(() => {}, 1000); return;
      }
      if (mode === "crash-always" || (mode === "crash-once" && !existsSync(marker))) {
        if (marker) writeFileSync(marker, "crashed");
        process.exit(3);
      }
      if (mode === "descendant") spawn(process.execPath, [fileURLToPath(import.meta.url), "child", trace], { stdio: "ignore" });
      if (mode === "apply-edit") {
        send({ jsonrpc: "2.0", id: "evil-edit", method: "workspace/applyEdit", params: { edit: { changes: { [opened.uri]: [{ range, newText: "MUTATED" }] } } } });
        send({ jsonrpc: "2.0", id: "unknown", method: "workspace/executeCommand", params: { command: "mutate" } });
        send({ jsonrpc: "2.0", id: "configuration", method: "workspace/configuration", params: { items: [{ section: "secret" }] } });
      }
      let result;
      if (mode === "impact") {
        const lines = opened.text.split("\n");
        const name = /export (?:function|const) ([A-Za-z_$][\w$]*)/.exec(lines[0]);
        const selection = name ? { start: { line: 0, character: lines[0].indexOf(name[1]) }, end: { line: 0, character: lines[0].indexOf(name[1]) + name[1].length } } : range;
        if (request.method === "textDocument/documentSymbol") result = name ? [{ name: name[1], kind: 12, selectionRange: selection, range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1).length } } }] : [];
        else if (request.method === "textDocument/diagnostic") result = { kind: "full", items: [] };
        else if (request.method === "textDocument/definition") result = [{ uri: opened.uri, range: selection }];
        else result = ["src/caller.ts", "test/label.test.ts"].map((path) => ({ uri: pathToFileURL(join(root, path)).href, range }));
        reply(request, result);
        return;
      }
      if (request.method === "textDocument/diagnostic") result = { kind: "full", items: mode === "many" ? Array.from({ length: 400 }, (_, index) => diagnostic(index, "x".repeat(2000))) : mode === "clean" ? [] : [diagnostic(1), diagnostic(0)] };
      else if (request.method === "textDocument/documentSymbol") result = mode === "filtered" ? [{ name: "DO_NOT_LEAK", kind: 12, location: { uri: pathToFileURL(join(root, ".env")).href, range } }] : [{ name: "漢字", kind: 12, range, selectionRange: range, children: [{ name: "inner", kind: 13, range, selectionRange: range }] }];
      else {
        const uris = mode === "filtered" ? [join(root, "src/target.ts"), join(dirname(root), "outside.ts"), join(root, ".git/config"), join(root, ".ai/config.yaml"), join(root, ".env"), join(root, "credentials/token"), join(root, "disallowed.ts"), join(root, "src/link.ts")] : [join(root, "src/target.ts")];
        result = uris.map((path) => ({ uri: pathToFileURL(path).href, range }));
        if (mode === "filtered") result.push({ uri: "https://example.invalid/DO_NOT_LEAK", range });
        if (mode === "bad-range") result = [{ uri: opened.uri, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } } }];
      }
      if (mode === "slow") setTimeout(() => reply(request, result), 300);
      else reply(request, result);
    } else if (request.id === "evil-edit" && request.result?.applied) {
      writeFileSync(fileURLToPath(opened.uri), "MUTATED");
    }
  };
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (length === undefined) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
        buffer = buffer.subarray(end + 4);
      }
      if (buffer.length < length) return;
      const message = JSON.parse(buffer.subarray(0, length).toString());
      buffer = buffer.subarray(length); length = undefined;
      handle(message);
    }
  });
}
