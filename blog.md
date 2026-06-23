# 用 Tauri 写了一个轻量级 Markdown 编辑器

作者：树萌芽

---

## 项目背景

其实起因挺简单的：平时写笔记离不开 Markdown，之前一直用Obsidian，但是Obsidian适合笔记整理,而我只想要个简单的markdown编辑器,发现vscode太重了每次打开需要等一段时间,UI也不是很好看,而typora正版太贵了,网上那些破解看着也不是很好,也不支持Android预览和编辑

后来干脆想，不如自己写一个算了。正好也想试试 Tauri 跨平台开发到底怎么样，于是打开 Claude Code，用 vibe coding 的方式边聊边写，慢慢把这个编辑器搭了起来。

于是就有了这个项目：**MD Editor**，一个基于 Tauri 2 + React + TypeScript 的桌面端 Markdown 编辑器。

GitHub 仓库：https://github.com/shumengya/md-editor

## 这是个什么样的工具

说白了就是一个专注于写 Markdown 的编辑器。打开速度快，界面干净，左边写、右边实时预览，支持深色和浅色主题切换。

我自己用下来比较舒服的几点：

- 分屏编辑，码字和看效果互不耽误
- GitHub 风格的 Markdown 渲染，代码高亮也够用
- 支持 `Ctrl+S` 保存、`Ctrl+O` 打开这些常规快捷键
- 退出前如果还有未保存的内容会弹窗提醒，避免手滑关掉
- 文件在外面被改动时也会提示要不要重新加载
- Windows 下可以注册右键菜单，双击 `.md` 文件直接打开

目前桌面端是主要场景，不过也顺手配了 Android 构建脚本，后面有兴趣可以往移动端再扩展一下。

## 用了什么技术

- **Tauri v2**：做桌面端壳子，体积小，比 Electron 轻很多
- **React 19 + TypeScript**：前端界面和状态管理
- **Vite 6**：开发构建
- **CodeMirror 6**：编辑器本体，支持 Markdown 语法高亮
- **Marked + Highlight.js**：把 Markdown 转成 HTML 并做代码高亮

Rust 后端只做了最基础的文件读写和 Windows 右键菜单注册，保持简单。

## 怎么跑起来

需要 Node.js 和 Rust 环境，然后：

```bash
# 安装依赖
npm install

# 开发运行
npm run tauri dev

# 构建桌面安装包
npm run tauri build
```

构建好的安装包会在 `src-tauri/target/release/bundle/` 下面。

## 为什么开源

做这个工具主要是为了自己用着爽，代码也没什么不能看的，就放到 GitHub 上了。如果你正好也在找类似的轻量编辑器，可以下载试试；如果发现问题或者有想法，欢迎提 Issue。

后续可能会继续加一些小功能，比如最近打开的文件列表、导出 PDF、自定义字体大小之类的，慢慢来。

---

感谢阅读，希望这个小工具对你也有用。
最后给个小彩蛋,这篇文章也是用这个软件写的   
