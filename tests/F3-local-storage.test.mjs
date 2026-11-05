// F3：本地存储，刷新后保留。同一份假 localStorage 先后喂给两次页面加载，模拟"刷新"。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
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
}

function openPage(sandboxExtras) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
  };
  vm.runInNewContext(script, { document, Date, ...sandboxExtras });
  const list = byId.get("list");
  const page = {
    empty: byId.get("empty"),
    texts: () => list.children.map((li) => li.children.find((c) => c.tagName === "SPAN").textContent),
    checked: () => list.children.map((li) => li.children.find((c) => c.tagName === "INPUT").checked),
    checkbox: (i) => list.children[i].children.find((c) => c.tagName === "INPUT"),
    deleteButton: (i) => list.children[i].children.find((c) => c.tagName === "BUTTON"),
    submit(text) {
      byId.get("new-text").value = text;
      byId.get("add-form").dispatch("submit");
    },
  };
  return page;
}

test("刷新后保留：新增、勾选、删除的结果在下次打开时原样恢复", () => {
  const localStorage = new FakeStorage();
  const first = openPage({ localStorage });
  first.submit("买牛奶");
  first.submit("写日报");
  first.submit("跑步");
  first.checkbox(1).dispatch("change");
  first.deleteButton(0).dispatch("click");

  const second = openPage({ localStorage });
  assert.deepEqual(second.texts(), ["写日报", "跑步"]);
  assert.deepEqual(second.checked(), [true, false]);
  assert.equal(second.empty.hidden, true);

  second.checkbox(0).dispatch("change");
  second.submit("看书");
  const third = openPage({ localStorage });
  assert.deepEqual(third.texts(), ["写日报", "跑步", "看书"]);
  assert.deepEqual(third.checked(), [false, false, false]);
});

test("刷新后再操作：新加的条目不会和恢复的条目撞号", () => {
  const localStorage = new FakeStorage();
  const first = openPage({ localStorage });
  first.submit("一");
  first.submit("二");

  const second = openPage({ localStorage });
  second.submit("三");
  second.checkbox(2).dispatch("change");
  assert.deepEqual(second.checked(), [false, false, true], "勾新条目不能连带勾上旧条目");
  second.deleteButton(2).dispatch("click");
  assert.deepEqual(second.texts(), ["一", "二"], "删新条目不能连带删掉旧条目");
});

test("删光后刷新仍是空状态", () => {
  const localStorage = new FakeStorage();
  const first = openPage({ localStorage });
  first.submit("一");
  first.deleteButton(0).dispatch("click");
  const second = openPage({ localStorage });
  assert.deepEqual(second.texts(), []);
  assert.equal(second.empty.hidden, false);
});

test("存储里是坏数据：页面照常打开为空，之后还能正常加和保存", () => {
  for (const bad of ["{不是 JSON", "null", "42", '{"todos":"x"}', '{"todos":[null,{"text":"   "},{"text":5}]}']) {
    const localStorage = new FakeStorage();
    localStorage.data.set("daily-todo.v1", bad);
    const page = openPage({ localStorage });
    assert.deepEqual(page.texts(), [], `坏数据 ${bad} 不该显示出条目`);
    page.submit("恢复后新加");
    assert.deepEqual(openPage({ localStorage }).texts(), ["恢复后新加"]);
  }
});

test("恢复的文本仍按纯文本显示", () => {
  const localStorage = new FakeStorage();
  localStorage.data.set("daily-todo.v1", JSON.stringify({ todos: [{ id: 1, text: "<b>粗</b>", done: false }] }));
  assert.deepEqual(openPage({ localStorage }).texts(), ["<b>粗</b>"]);
});

test("浏览器禁用本地存储时页面照常可用（只是不保留）", () => {
  const noStorage = openPage({});
  noStorage.submit("一");
  assert.deepEqual(noStorage.texts(), ["一"]);

  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  const page = openPage({ localStorage: throwing });
  page.submit("二");
  page.checkbox(0).dispatch("change");
  assert.deepEqual(page.texts(), ["二"]);
  assert.deepEqual(page.checked(), [true]);
});
