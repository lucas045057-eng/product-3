// F4：顶部显示今天完成几条/共几条，并在新增、勾选、删除、刷新、跨页同步后实时一致。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { ROOT } from "../scripts/build.mjs";

const html = readFileSync(path.join(ROOT, "todo", "index.html"), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

class FakeElement {
  constructor(tag, id) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = "";
    this.hidden = false;
    this.value = "";
    this.checked = false;
    this._text = "";
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type, event = {}) {
    if (type === "change" && this.type === "checkbox") this.checked = !this.checked;
    for (const fn of this.listeners[type] ?? []) fn({ target: this, preventDefault() {}, ...event });
  }
}

class FakeStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  removeItem(key) { this.data.delete(key); }
}

function openPage(localStorage = new FakeStorage()) {
  const listeners = {};
  const addEventListener = (name, fn) => (listeners[name] ??= []).push(fn);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
    addEventListener,
    visibilityState: "visible",
  };
  vm.runInNewContext(script, { document, Date, crypto: webcrypto, addEventListener, localStorage });
  const list = byId.get("list");
  const page = {
    summary: () => byId.get("summary").textContent,
    event(name, event = {}) { for (const fn of listeners[name] ?? []) fn(event); },
    checkbox: (i) => list.children[i].children.find((c) => c.tagName === "INPUT"),
    deleteButton: (i) => list.children[i].children.find((c) => c.tagName === "BUTTON"),
    submit(text) {
      byId.get("new-text").value = text;
      byId.get("add-form").dispatch("submit");
    },
  };
  return page;
}

test("摘要在页面顶部的标题区里", () => {
  const header = /<header>([\s\S]*?)<\/header>/.exec(html)?.[1] ?? "";
  assert.match(header, /id="summary"/);
  assert.ok(html.indexOf('id="summary"') < html.indexOf('id="list"'), "摘要要在列表上方");
});

test("空列表显示 0/0", () => {
  assert.equal(openPage().summary(), "今天完成 0 条 / 共 0 条");
});

test("新增、勾选、取消、删除后计数立即一致", () => {
  const page = openPage();
  page.submit("一");
  page.submit("二");
  page.submit("三");
  assert.equal(page.summary(), "今天完成 0 条 / 共 3 条");
  page.checkbox(0).dispatch("change");
  page.checkbox(2).dispatch("change");
  assert.equal(page.summary(), "今天完成 2 条 / 共 3 条");
  page.checkbox(0).dispatch("change");
  assert.equal(page.summary(), "今天完成 1 条 / 共 3 条");
  page.deleteButton(2).dispatch("click");
  assert.equal(page.summary(), "今天完成 0 条 / 共 2 条");
  page.deleteButton(0).dispatch("click");
  page.deleteButton(0).dispatch("click");
  assert.equal(page.summary(), "今天完成 0 条 / 共 0 条");
});

test("空内容不计入总数", () => {
  const page = openPage();
  page.submit("   ");
  assert.equal(page.summary(), "今天完成 0 条 / 共 0 条");
});

test("刷新后计数与恢复的列表一致", () => {
  const storage = new FakeStorage();
  const first = openPage(storage);
  first.submit("一");
  first.submit("二");
  first.checkbox(1).dispatch("change");
  assert.equal(openPage(storage).summary(), "今天完成 1 条 / 共 2 条");
});

test("另一页改动同步过来后计数跟着更新", () => {
  const storage = new FakeStorage();
  const a = openPage(storage);
  const b = openPage(storage);
  a.submit("一");
  b.event("storage", { key: null });
  assert.equal(b.summary(), "今天完成 0 条 / 共 1 条");
  a.checkbox(0).dispatch("change");
  b.event("storage", { key: null });
  assert.equal(b.summary(), "今天完成 1 条 / 共 1 条");
});
