# MDEditor

一款基于 **Tauri v2 + React + TypeScript** 构建的轻量级 Markdown 桌面编辑器，支持 GitHub 风格实时预览、明暗主题切换、文件关联与外部修改监听。

> 喵~ 这是一个仍在持续打磨中的小工具，欢迎 Star 和 Issue ✨

---

## 功能特性

- 📝 **双栏实时预览** — 左侧编辑，右侧同步渲染 GitHub 风格 Markdown
- 🌗 **明暗主题切换** — 编辑器与预览区均支持深色 / 浅色模式
- ⌨️ **常用快捷键** — 新建、打开、保存、切换视图一键直达
- 💾 **文件操作** — 新建、打开、保存、另存为，支持 `.md` / `.markdown` / `.txt`
- 🔗 **文件关联** — Windows 下可注册右键菜单“使用 MDEditor 打开”
- 👀 **外部修改监听** — 文件被其他程序修改时自动提示重载
- 🚪 **退出保护** — 未保存时拦截关闭，防止误操作丢失内容
- 📱 **移动端构建** — 已配置 Android 构建脚本

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri v2](https://v2.tauri.app/) |
| 前端框架 | React 19 + TypeScript 5 |
| 构建工具 | Vite 6 |
| 编辑器 | CodeMirror 6（`@codemirror/lang-markdown`） |
| Markdown 渲染 | Marked + Highlight.js |
| 样式 | 原生 CSS + github-markdown-css |
| 后端命令 | Rust（`std::fs` + Tauri 插件） |

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://www.rust-lang.org/tools/install) 工具链
-（Windows）如需构建 `.msi` / `.exe` 安装包，建议安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run tauri dev
```

### 构建桌面应用

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

### 构建 Android APK

```bash
npm run android
```

只编译 arm64。项目使用的 Gradle 8.14 不支持 JDK 25，需要把 `JAVA_HOME` 指向 JDK 21（例如 Android Studio 自带的 `jbr`）。

---

## 下载

到 [Releases](https://github.com/shumengya/MDEditer/releases/latest) 页面下载，提供 Windows (amd64)、Linux (amd64 / arm64)、Android (arm64) 安装包。

## 发布新版本

版本号使用发布日期，格式为 `vYYYY.MM.DD`，同一天只能发一个版本。

1. 写更新日志 `.github/release-notes/vYYYY.MM.DD.md`，它会原样成为 Release 正文
2. 提交其余改动后执行 `node scripts/release.mjs`：写入版本号、提交、打标签并推送
3. GitHub Actions 自动构建四个平台，全部成功后发布；任一平台失败时 Release 停留在草稿状态

Android 正式签名所需的密钥保存在仓库 Secrets（`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`）中，不进入代码仓库。

---

## 快捷键

| 操作 | 快捷键 |
|------|--------|
| 新建文件 | `Ctrl + N` |
| 打开文件 | `Ctrl + O` |
| 保存 | `Ctrl + S` |
| 另存为 | `Ctrl + Shift + S` |
| 切换编辑/预览/分屏 | `Ctrl + P` |

---

## 项目结构

```text
MDEditor/
├── public/                  # 静态资源（图标、字体）
├── scripts/                 # 字体子集化相关脚本
├── src/
│   ├── components/          # React 组件（Editor / Preview / Toolbar / StatusBar）
│   ├── context/             # 主题上下文
│   ├── hooks/               # 文件状态 Hook
│   ├── lib/                 # Markdown 渲染
│   ├── styles/              # 全局与字体样式
│   ├── App.tsx              # 主应用
│   └── main.tsx             # 入口
├── src-tauri/
│   ├── src/                 # Rust 源码
│   ├── icons/               # 应用图标
│   ├── Cargo.toml           # Rust 依赖
│   └── tauri.conf.json      # Tauri 配置
├── package.json
├── vite.config.ts
└── README.md
```

---

## 贡献

欢迎提交 Issue 或 Pull Request！如果你发现 bug 或有新功能建议，请随时交流。

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
