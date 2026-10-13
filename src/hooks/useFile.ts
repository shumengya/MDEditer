import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readTextFile as pluginReadFile } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";

const readTextFile = (path: string): Promise<string> =>
  path.startsWith("content://")
    ? pluginReadFile(path)
    : invoke<string>("read_text_file", { path });

const writeTextFile = (path: string, content: string) => invoke<void>("write_text_file", { path, content });

const LAST_FILE_KEY = "mdeditor-last-file";

/** 外部修改常是连续几次写入(先截断再写、临时文件改名)，合并后只处理最后一次 */
const EXTERNAL_CHANGE_DEBOUNCE_MS = 200;

export interface FileState {
  path: string | null;
  content: string;
  saved: boolean;
  name: string;
}

/** 文件在磁盘上的原始格式，保存时按原样还原，避免无意中改掉别人的换行风格 */
interface TextFormat {
  bom: boolean;
  eol: "\n" | "\r\n";
}

interface DocState {
  path: string | null;
  name: string;
  content: string;
  /** 磁盘上的内容(已规范化)；content 与它相同即视为已保存 */
  baseline: string;
  format: TextFormat;
}

const DEFAULT_FORMAT: TextFormat = { bom: false, eol: "\n" };

/**
 * CodeMirror 内部一律用 \n，读进来的 \r\n 不先统一的话，编辑器一挂载就会把文档
 * 改写成 \n 版本并回传，和原文不等 → 文件明明没动却被判为未保存。
 */
function decodeText(raw: string): { text: string; format: TextFormat } {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  return { text: body.replace(/\r\n?/g, "\n"), format: { bom, eol } };
}

function encodeText(text: string, format: TextFormat): string {
  const body = format.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return format.bom ? "\uFEFF" + body : body;
}

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() ?? "未命名.md";

const DEFAULT_CONTENT = `# 欢迎使用 MDEditor

一款轻量级 Markdown 编辑器，支持 GitHub 风格预览。

## 功能特性

- **分屏视图** — 左侧编辑，右侧实时预览
- **GitHub 风格** Markdown 渲染，霞鹜文楷 + Maple Mono 排版
- **代码高亮** 支持多种编程语言
- **明暗模式** 点击右上角 ⋮ 切换主题
- **文件操作** — 打开、保存、另存为

## 快捷键

| 操作 | 快捷键 |
|------|--------|
| 新建文件 | \`Ctrl+N\` |
| 打开文件 | \`Ctrl+O\` |
| 保存 | \`Ctrl+S\` |
| 另存为 | \`Ctrl+Shift+S\` |
| 切换预览 | \`Ctrl+P\` |

## 代码示例

\`\`\`typescript
function greet(name: string): string {
  return \`你好，\${name}！\`;
}

console.log(greet("世界"));
\`\`\`

> 开始编辑此文档，或打开一个 \`.md\` 文件以开始使用。
`;

export function useFile() {
  const [doc, setDoc] = useState<DocState>({
    path: null,
    name: "未命名.md",
    content: DEFAULT_CONTENT,
    baseline: DEFAULT_CONTENT,
    format: DEFAULT_FORMAT,
  });

  // 事件回调里读最新状态用，避免闭包拿到旧值
  const docRef = useRef(doc);
  docRef.current = doc;
  const debounceRef = useRef<number | null>(null);
  // 正在弹「是否重新加载」时，后续外部修改事件先忽略，免得叠出一串对话框
  const askingRef = useRef(false);

  const saved = doc.content === doc.baseline;

  const fileState = useMemo<FileState>(
    () => ({ path: doc.path, content: doc.content, saved, name: doc.name }),
    [doc.path, doc.content, saved, doc.name]
  );

  useEffect(() => {
    getCurrentWindow()
      .setTitle(`${saved ? "" : "● "}${doc.name} — MDEditor`)
      .catch(() => {});
  }, [doc.name, saved]);

  const startWatcher = useCallback(async (path: string) => {
    // content:// 是安卓 SAF 的虚拟路径，没有可监听的真实文件
    if (path.startsWith("content://")) {
      await invoke("unwatch_file").catch(() => {});
      return;
    }
    try {
      await invoke("watch_file", { path });
    } catch (e) {
      console.error("文件监听启动失败:", e);
    }
  }, []);

  const handleExternalChange = useCallback(async (path: string) => {
    const current = docRef.current;
    if (current.path !== path || askingRef.current) return;

    let decoded: ReturnType<typeof decodeText>;
    try {
      decoded = decodeText(await readTextFile(path));
    } catch {
      // 对方可能正写到一半或文件被删，等下一次事件
      return;
    }

    // 与磁盘基准一致：多半是自己刚保存触发的回声，或对方只改了时间戳
    if (decoded.text === current.baseline) return;

    const applyDisk = (text: string, format: TextFormat) =>
      setDoc((prev) => (prev.path === path ? { ...prev, content: text, baseline: text, format } : prev));

    // 没有未保存修改，直接静默同步
    if (current.content === current.baseline) {
      applyDisk(decoded.text, decoded.format);
      return;
    }

    askingRef.current = true;
    try {
      const reload = await ask(
        "文件已在外部被修改，是否重新加载？\n选择「否」将保留你当前未保存的内容。",
        { title: "文件已更改", kind: "warning" }
      );
      if (reload) {
        // 对话框期间文件可能又变了，取最新的
        const latest = decodeText(await readTextFile(path));
        applyDisk(latest.text, latest.format);
      } else {
        // 保留本地版本，但基准跟上磁盘：之后相同的事件不再打扰，且仍显示为未保存
        setDoc((prev) => (prev.path === path ? { ...prev, baseline: decoded.text, format: decoded.format } : prev));
      }
    } catch (e) {
      console.error("重新加载文件失败:", e);
    } finally {
      askingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("file-changed", (event) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        handleExternalChange(event.payload);
      }, EXTERNAL_CHANGE_DEBOUNCE_MS);
    });
    return () => {
      unlisten.then((fn) => fn());
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [handleExternalChange]);

  const setContent = useCallback((content: string) => {
    setDoc((prev) => (prev.content === content ? prev : { ...prev, content }));
  }, []);

  const newFile = useCallback(() => {
    invoke("unwatch_file").catch(() => {});
    setDoc({ path: null, name: "未命名.md", content: "", baseline: "", format: DEFAULT_FORMAT });
  }, []);

  const openFile = useCallback(
    async (filePath?: string) => {
      try {
        let path = filePath;
        if (!path) {
          const selected = await open({
            filters: [{ name: "Markdown 文件", extensions: ["md", "markdown", "txt"] }],
            multiple: false,
          });
          if (!selected) return;
          path = selected as string;
        }
        const { text, format } = decodeText(await readTextFile(path));
        setDoc({ path, name: fileNameOf(path), content: text, baseline: text, format });
        localStorage.setItem(LAST_FILE_KEY, path);
        await startWatcher(path);
      } catch (e) {
        console.error("打开文件失败:", e);
        if (filePath) localStorage.removeItem(LAST_FILE_KEY);
      }
    },
    [startWatcher]
  );

  /** 写到指定路径；基准取写出去的那份快照，而不是写完后的最新内容(写盘期间用户可能还在打字) */
  const writeTo = useCallback(
    async (path: string) => {
      const { content, format, path: oldPath } = docRef.current;
      await writeTextFile(path, encodeText(content, format));
      setDoc((prev) => ({ ...prev, path, name: fileNameOf(path), baseline: content }));
      localStorage.setItem(LAST_FILE_KEY, path);
      if (path !== oldPath) await startWatcher(path);
    },
    [startWatcher]
  );

  const saveFileAs = useCallback(async () => {
    try {
      const selected = await save({
        filters: [{ name: "Markdown 文件", extensions: ["md", "markdown"] }],
        defaultPath: docRef.current.name,
      });
      if (!selected) return;
      await writeTo(selected);
    } catch (e) {
      console.error("另存为失败:", e);
    }
  }, [writeTo]);

  const saveFile = useCallback(async () => {
    const path = docRef.current.path;
    if (!path) {
      await saveFileAs();
      return;
    }
    try {
      await writeTo(path);
    } catch (e) {
      console.error("保存文件失败:", e);
    }
  }, [writeTo, saveFileAs]);

  return { fileState, setContent, newFile, openFile, saveFile, saveFileAs };
}
