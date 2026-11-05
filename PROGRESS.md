# 进度

## 已完成

- F1 待办单页骨架：`todo/index.html`（零外部资源、可直接打开，窄屏不溢出），构建产物含 `todo/`，首页加了入口链接。验证：`node --test tests/F1-todo-page.test.mjs`。
- F2 新增/勾选/删除：空内容和纯空白不能加，文本去首尾空白、按纯文本显示；勾选可取消；删除只影响点的那一条。验证：`node --test tests/F2-add-toggle-delete.test.mjs`。
- F3 本地存储：每次新增/勾选/删除后写入浏览器本地存储（键 `daily-todo.v1`），打开页面时恢复；存储里是坏数据就当空列表，浏览器禁用存储时页面照常可用、只是不保留。验证：`node --test tests/F3-local-storage.test.mjs`。

## 进行中

（暂无）——下一项 F4：顶部显示今天完成几条/共几条并实时一致。

## 卡住

（暂无）

---
立项：https://github.com/lucas045057-eng/secretary-playground/issues/3
