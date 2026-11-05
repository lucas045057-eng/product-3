# 进度

## 已完成

- F1 待办单页骨架：`todo/index.html`（零外部资源、可直接打开，窄屏不溢出），构建产物含 `todo/`，首页加了入口链接。验证：`node --test tests/F1-todo-page.test.mjs`。
- F2 新增/勾选/删除：空内容和纯空白不能加，文本去首尾空白、按纯文本显示；勾选可取消；删除只影响点的那一条。数据暂时只在内存里（刷新会丢，F3 做本地存储）。验证：`node --test tests/F2-add-toggle-delete.test.mjs`。

## 进行中

（暂无）——下一项 F3：本地存储，刷新后保留。

## 卡住

（暂无）

---
立项：https://github.com/lucas045057-eng/secretary-playground/issues/3
