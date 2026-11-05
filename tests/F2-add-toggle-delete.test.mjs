// F2：新增（空内容不可加）、勾选/取消、删除。页面内联脚本在 vm 里配一个最小 DOM 真跑。
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

function openPage() {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
  };
  vm.runInNewContext(script, { document, Date });
  const list = byId.get("list");
  const page = {
    list,
    empty: byId.get("empty"),
    input: byId.get("new-text"),
    items: () => list.children,
    texts: () => list.children.map((li) => li.children.find((c) => c.tagName === "SPAN").textContent),
    checkbox: (i) => list.children[i].children.find((c) => c.tagName === "INPUT"),
    deleteButton: (i) => list.children[i].children.find((c) => c.tagName === "BUTTON"),
    submit(text) {
      page.input.value = text;
      let prevented = false;
      byId.get("add-form").dispatch("submit", { preventDefault: () => (prevented = true) });
      assert.ok(prevented, "提交不能让页面跳转");
    },
  };
  return page;
}

test("新增：提交后出现在列表末尾，文本去掉首尾空白，输入框清空，空状态隐藏", () => {
  const page = openPage();
  assert.equal(page.items().length, 0);
  assert.equal(page.empty.hidden, false);
  page.submit("  买牛奶 ");
  page.submit("写日报");
  assert.deepEqual(page.texts(), ["买牛奶", "写日报"]);
  assert.equal(page.input.value, "");
  assert.equal(page.empty.hidden, true);
  assert.equal(page.checkbox(0).type, "checkbox");
  assert.equal(page.checkbox(0).checked, false);
});

test("空内容不可加：空串和纯空白都不新增，输入保持原样", () => {
  const page = openPage();
  for (const blank of ["", "   ", "\t\n "]) {
    page.submit(blank);
    assert.equal(page.items().length, 0, `不该加入 ${JSON.stringify(blank)}`);
    assert.equal(page.input.value, blank);
  }
  assert.equal(page.empty.hidden, false);
});

test("勾选/取消：勾上标记完成，再点恢复未完成，只影响这一条", () => {
  const page = openPage();
  page.submit("一");
  page.submit("二");
  page.checkbox(0).dispatch("change");
  assert.equal(page.checkbox(0).checked, true);
  assert.equal(page.items()[0].className, "done");
  assert.equal(page.checkbox(1).checked, false);
  assert.equal(page.items()[1].className, "");
  page.checkbox(0).dispatch("change");
  assert.equal(page.checkbox(0).checked, false);
  assert.equal(page.items()[0].className, "");
});

test("删除：只删点的那一条，删光后回到空状态", () => {
  const page = openPage();
  page.submit("一");
  page.submit("二");
  page.submit("三");
  page.checkbox(2).dispatch("change");
  page.deleteButton(1).dispatch("click");
  assert.deepEqual(page.texts(), ["一", "三"]);
  assert.equal(page.checkbox(1).checked, true, "删除不应改动其它条目的勾选状态");
  page.deleteButton(0).dispatch("click");
  page.deleteButton(0).dispatch("click");
  assert.equal(page.items().length, 0);
  assert.equal(page.empty.hidden, false);
});

test("待办文本按纯文本显示，不当作 HTML 解析", () => {
  const page = openPage();
  page.submit("<img src=x onerror=alert(1)>");
  assert.deepEqual(page.texts(), ["<img src=x onerror=alert(1)>"]);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});
