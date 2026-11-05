// F3：本地存储，刷新后保留。同一份假 localStorage 先后喂给两次页面加载，模拟"刷新"。
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

function openPage(sandboxExtras) {
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
  vm.runInNewContext(script, { document, Date, crypto: webcrypto, addEventListener, ...sandboxExtras });
  const list = byId.get("list");
  const page = {
    empty: byId.get("empty"),
    status: byId.get("storage-status"),
    event(name, event = {}) { for (const fn of listeners[name] ?? []) fn(event); },
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

// Writes reach the shared store, but each tab reads its own stale snapshot until flush.
class SharedBackend {
  constructor() { this.data = new Map(); this.tabs = []; }
  open() {
    const storage = new FakeStorage();
    storage.data = new Map(this.data);
    storage.setItem = (key, value) => {
      storage.data.set(key, String(value));
      this.data.set(key, String(value));
    };
    const page = openPage({ localStorage: storage });
    this.tabs.push({ storage, page });
    return page;
  }
  flush() {
    for (const tab of this.tabs) tab.storage.data = new Map(this.data);
    for (const tab of this.tabs) tab.page.event("storage", { key: null });
  }
}

test("两个旧缓存同时新增：两条都保存，条目互不覆盖", () => {
  const backend = new SharedBackend();
  const a = backend.open(), b = backend.open();
  a.submit("页面A"); b.submit("页面B");
  backend.flush();
  assert.deepEqual([...backend.open().texts()].sort(), ["页面A", "页面B"]);
  assert.deepEqual([...a.texts()].sort(), ["页面A", "页面B"]);
  assert.deepEqual([...b.texts()].sort(), ["页面A", "页面B"]);
});

test("删除胜过旧页勾选：延迟同步也不复活", () => {
  const backend = new SharedBackend();
  const a = backend.open(); a.submit("删除我");
  const b = backend.open();
  a.deleteButton(0).dispatch("click");
  b.checkbox(0).dispatch("change");
  backend.flush();
  assert.deepEqual(backend.open().texts(), []);
  assert.deepEqual(b.texts(), []);
});

test("旧页面修改另一条，不覆盖已保存的勾选", () => {
  const backend = new SharedBackend();
  const a = backend.open(); a.submit("第一条"); a.submit("第二条");
  const b = backend.open();
  a.checkbox(0).dispatch("change");
  b.checkbox(1).dispatch("change");
  backend.flush();
  assert.deepEqual(backend.open().checked(), [true, true]);
});

test("v1导入幂等、保留原值，删除后再打开不会重新导入", () => {
  const backend = new SharedBackend();
  const legacy = JSON.stringify({ todos: [{ id: 1, text: "旧任务", done: true }] });
  backend.data.set("daily-todo.v1", legacy);
  const a = backend.open(), b = backend.open();
  assert.deepEqual(a.texts(), ["旧任务"]);
  assert.deepEqual(b.checked(), [true]);
  a.deleteButton(0).dispatch("click");
  backend.flush();
  assert.deepEqual(backend.open().texts(), []);
  assert.equal(backend.data.get("daily-todo.v1"), legacy);
});

test("存储写失败：显示警告，刷新丢失，但本页未保存改动在同步后仍可重试", () => {
  const storage = new FakeStorage();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = () => { throw Error("QuotaExceededError"); };
  const page = openPage({ localStorage: storage });
  page.submit("未保存"); page.event("focus");
  assert.deepEqual(page.texts(), ["未保存"]);
  assert.equal(page.status?.hidden, false);
  assert.match(page.status.textContent, /未.*保存|不会保留/);
  assert.deepEqual(openPage({ localStorage: storage }).texts(), []);
  storage.setItem = setItem;
  page.submit("恢复后");
  assert.deepEqual(openPage({ localStorage: storage }).texts(), ["未保存", "恢复后"]);
});

test("v2损坏记录保留原字节，不妨碍其他条目保存", () => {
  const storage = new FakeStorage();
  storage.setItem("daily-todo.v2.item.bad", "{broken");
  const page = openPage({ localStorage: storage });
  page.submit("正常条目");
  assert.deepEqual(openPage({ localStorage: storage }).texts(), ["正常条目"]);
  assert.equal(storage.getItem("daily-todo.v2.item.bad"), "{broken");
});

test("并发v1导入不能覆盖另一页刚写入的勾选状态", () => {
  const storage = new FakeStorage();
  storage.setItem("daily-todo.v1", JSON.stringify({ todos: [{ id: 7, text: "迁移期间", done: false }] }));
  const set = storage.setItem.bind(storage);
  let intercepted = false;
  storage.setItem = (key, value) => {
    if (!intercepted && key.startsWith("daily-todo.v2.item.")) {
      intercepted = true;
      const other = openPage({ localStorage: storage });
      other.checkbox(0).dispatch("change");
    }
    set(key, value);
  };
  openPage({ localStorage: storage });
  assert.equal(intercepted, true);
  assert.deepEqual(openPage({ localStorage: storage }).checked(), [true]);
});

test("无storage通知时，focus与visibilitychange仍重新读取；无关事件忽略", () => {
  const storage = new FakeStorage();
  const a = openPage({ localStorage: storage }), b = openPage({ localStorage: storage });
  a.submit("同步任务");
  b.event("storage", { key: "unrelated" });
  assert.deepEqual(b.texts(), []);
  b.event("focus");
  assert.deepEqual(b.texts(), ["同步任务"]);
  a.checkbox(0).dispatch("change");
  b.event("visibilitychange");
  assert.deepEqual(b.checked(), [true]);
  a.deleteButton(0).dispatch("click");
  b.event("storage", { key: [...storage.data.keys()].find(key => key.includes(".del.")) });
  assert.deepEqual(b.texts(), []);
});

test("读取突然失败不会清空已有列表，恢复后重试未保存操作", () => {
  const storage = new FakeStorage();
  const page = openPage({ localStorage: storage });
  page.submit("原有");
  const get = storage.getItem.bind(storage);
  storage.getItem = () => { throw Error("SecurityError"); };
  page.event("focus");
  page.submit("暂存");
  assert.deepEqual(page.texts(), ["原有", "暂存"]);
  assert.match(page.status.textContent, /不可用/);
  storage.getItem = get;
  page.checkbox(0).dispatch("change");
  const reopened = openPage({ localStorage: storage });
  assert.deepEqual(reopened.texts(), ["原有", "暂存"]);
  assert.deepEqual(reopened.checked(), [true, false]);
});

test("缺少crypto时仍可存储和刷新恢复；损坏v1不被覆盖", () => {
  const storage = new FakeStorage();
  storage.setItem("daily-todo.v1", "{broken");
  const page = openPage({ localStorage: storage, crypto: undefined });
  page.submit("降级一"); page.submit("降级二");
  assert.deepEqual(openPage({ localStorage: storage }).texts(), ["降级一", "降级二"]);
  assert.equal(storage.getItem("daily-todo.v1"), "{broken");
});

test("同一条相反状态以后写为准，不触碰其他条目", () => {
  const backend = new SharedBackend();
  const a = backend.open(); a.submit("共同任务"); a.submit("其他");
  const b = backend.open();
  a.checkbox(0).dispatch("change");
  b.checkbox(0).dispatch("change");
  b.checkbox(0).dispatch("change");
  backend.flush();
  assert.deepEqual(backend.open().checked(), [false, false]);
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
