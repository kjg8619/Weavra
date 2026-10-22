// Inline the temporary todo-22 catalog fragments (i18n/ko.<group>.ts) into the single i18n/ko.ts,
// using the TypeScript AST so template literals and nested braces are copied verbatim.
// Usage: bun tools/inline-catalog.mjs <worktree>
import * as fs from "node:fs/promises";
import * as path from "node:path";

const worktree = process.argv[2];
const i18n = path.join(worktree, "app/t3code/apps/web/src/i18n");
const ts = (await import(path.join(worktree, "app/t3code/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/typescript.js"))).default;

const koPath = path.join(i18n, "ko.ts");
let ko = await fs.readFile(koPath, "utf8");
const importRe = /^import \{ (ko\w+) \} from "\.\/ko\.(\w+)";\n/gm;
const fragments = [...ko.matchAll(importRe)].map((m) => ({ exportName: m[1], file: `ko.${m[2]}.ts` }));
if (fragments.length === 0) throw new Error("No catalog fragments are imported by ko.ts");

for (const { exportName, file } of fragments) {
  const source = await fs.readFile(path.join(i18n, file), "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let root;
  sf.forEachChild((node) => {
    if (ts.isVariableStatement(node))
      for (const decl of node.declarationList.declarations)
        if (decl.name.getText(sf) === exportName) root = decl.initializer;
  });
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error(`${file}: ${exportName} is not an object literal`);
  for (const prop of root.properties) {
    if (!ts.isPropertyAssignment(prop)) throw new Error(`${file}: unexpected member ${prop.getText(sf)}`);
    const key = prop.name.getText(sf);
    const call = prop.initializer;
    if (!ts.isCallExpression(call) || !ts.isObjectLiteralExpression(call.arguments[0]))
      throw new Error(`${file}: ${key} is not freeze({...})`);
    const members = call.arguments[0].properties.map((member) => member.getText(sf));
    const spread = `...${exportName}.${key},`;
    const at = ko.indexOf(spread);
    if (at < 0) throw new Error(`ko.ts does not spread ${exportName}.${key}`);
    if (ko.indexOf(spread, at + 1) >= 0) throw new Error(`ko.ts spreads ${exportName}.${key} twice`);
    const lineStart = ko.lastIndexOf("\n", at) + 1;
    const indent = ko.slice(lineStart, at);
    const body = members.map((member) => `${indent}${member},`).join("\n");
    ko = ko.slice(0, lineStart) + (body ? `${body}\n` : "") + ko.slice(at + spread.length + 1);
  }
}
ko = ko.replace(importRe, "");
if (/ko[A-Z]\w+\.\w+/.test(ko.replace(/export const ko\b|KoCatalog/g, ""))) throw new Error("Unresolved fragment reference remains");
await fs.writeFile(koPath, ko);
for (const { file } of fragments) await fs.rm(path.join(i18n, file));
console.log(`INLINED ${fragments.length} fragments: ${fragments.map((f) => f.file).join(", ")}`);
