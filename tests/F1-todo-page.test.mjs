// F1：todo 目录下可直接打开的单页，手机窄屏不溢出。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { build, ROOT } from "../scripts/build.mjs";
import { startServer } from "../scripts/serve.mjs";

const PAGE = path.join(ROOT, "todo", "index.html");
const html = existsSync(PAGE) ? readFileSync(PAGE, "utf8") : "";
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

test("todo/index.html 存在，是完整的单页", () => {
  assert.ok(existsSync(PAGE), "缺少 todo/index.html");
  assert.match(html.trimStart(), /^<!doctype html>/i);
  assert.match(html, /<html[^>]*\blang=/);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<title>[^<]+<\/title>/);
});

test("可直接打开：不依赖任何外部或同站的其它文件，不发网络请求", () => {
  assert.doesNotMatch(html, /(?:src|href|action)\s*=\s*["'](?!#)[^"']/i, "不许引用其它文件或地址");
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel=["']?stylesheet/i);
  assert.doesNotMatch(html, /@import|url\(/i);
  assert.doesNotMatch(script, /\bfetch\(|XMLHttpRequest|import\(/);
  assert.match(html, /http-equiv="Content-Security-Policy"[^>]*default-src 'none'/);
  assert.doesNotMatch(html, /\bdebugger\b|console\.(log|debug)\(/);
});

test("窄屏不溢出：视口、border-box、无超过 320px 的固定宽度、长文本可折行", () => {
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(css, /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box/);
  assert.match(css, /body\s*\{[^}]*overflow-x:\s*hidden/);
  for (const m of css.matchAll(/(?:^|[;{\s])((?:min-)?width)\s*:\s*(\d+(?:\.\d+)?)(px|rem|em|vw)/g)) {
    const [, prop, value, unit] = m;
    const px = unit === "px" ? Number(value) : unit === "vw" ? (Number(value) / 100) * 320 : Number(value) * 16;
    assert.ok(px <= 320 || (unit === "vw" && Number(value) <= 100), `${prop}: ${value}${unit} 在 320px 宽的屏幕上会溢出`);
  }
  assert.match(css, /li\s*\{[^}]*overflow-wrap:\s*anywhere/, "长待办要能折行");
  assert.match(css, /input\[type="text"\]\s*\{[^}]*min-width:\s*0/, "输入框要能在窄屏收缩");
  assert.match(css, /main\s*\{[^}]*max-width:[^;]+;[^}]*/);
});

test("页面骨架齐全，内联脚本真跑一遍不出错并显示本地日期", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const id of ["today", "add-form", "new-text", "add-button", "list", "empty"]) assert.ok(ids.has(id), `缺少 #${id}`);
  const elements = new Map();
  const listeners = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, textContent: "", addEventListener: (type, fn) => listeners.push([id, type, fn]) });
    return elements.get(id);
  };
  const fixed = new Date(2026, 0, 5, 23, 30);
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixed.getTime()]));
    }
  }
  vm.runInNewContext(script, { document: { getElementById: (id) => (ids.has(id) ? element(id) : null) }, Date: FakeDate });
  assert.equal(element("today").textContent, "2026-01-05");
  const submit = listeners.find(([id, type]) => id === "add-form" && type === "submit");
  assert.ok(submit, "表单提交要被接管，不能让页面跳转");
  let prevented = false;
  submit[2]({ preventDefault: () => (prevented = true) });
  assert.ok(prevented);
});

test("构建产物里有 todo/index.html，并能通过 /todo/ 访问", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "f1-"));
  try {
    build(out, { GITHUB_SHA: "a".repeat(40), GITHUB_REPOSITORY: "me/app" });
    assert.equal(readFileSync(path.join(out, "todo", "index.html"), "utf8"), html);
    const { server, port } = await startServer(out, 0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/todo/`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(await response.text(), html);
    } finally {
      server.close();
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
