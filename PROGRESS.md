# 进度

## 已完成

- F1 待办单页骨架：`todo/index.html`（零外部资源、可直接打开，窄屏不溢出），构建产物含 `todo/`，首页加了入口链接。验证：`node --test tests/F1-todo-page.test.mjs`。
- F2 新增/勾选/删除：空内容和纯空白不能加，文本去首尾空白、按纯文本显示；勾选可取消；删除只影响点的那一条。验证：`node --test tests/F2-add-toggle-delete.test.mjs`。
- F3 本地存储：使用 `daily-todo.v2.*` 独立条目、完成状态及删除标记，避免旧标签页覆盖其他条目或恢复已删除内容；兼容导入并保留 `daily-todo.v1`。存储不可用或保存失败时显示提示，未保存操作保留在当前页面，后续操作重试；同一条目的并发勾选以后写为准。旧版页面需刷新后再操作，删除标记暂不清理。验证命令保持全量 `node --test`。

## 进行中

（暂无）——下一项 F4：顶部显示今天完成几条/共几条并实时一致。

## 卡住

（暂无）

---
立项：https://github.com/lucas045057-eng/secretary-playground/issues/3
