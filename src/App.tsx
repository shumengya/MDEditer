import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import Toolbar, { ViewMode } from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import { useFile } from "./hooks/useFile";
import "./App.css";

const Editor = lazy(() => import("./components/Editor"));
const Preview = lazy(() => import("./components/Preview"));

const isMobile = () => window.innerWidth <= 768;

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>(isMobile() ? "preview" : "split");
  const { fileState, setContent, newFile, openFile, saveFile, saveFileAs } = useFile();

  const editorScrollControlRef = useRef<((line: number) => void) | null>(null);
  const previewScrollControlRef = useRef<((line: number) => void) | null>(null);

  // 回声由两侧各自判断(它们能直接比对滚动像素)，这里只负责把「行号」这个
  // 共同坐标从一侧传到另一侧。用行号而非滚动百分比，是因为同一段文字在
  // 源码和渲染结果里的高度完全不成比例，按百分比对齐会越滚越偏。
  const handleEditorScroll = useCallback((line: number) => {
    previewScrollControlRef.current?.(line);
  }, []);

  const handlePreviewScroll = useCallback((line: number) => {
    editorScrollControlRef.current?.(line);
  }, []);

  // Receive file path at startup: Android intent (JavascriptInterface) or desktop CLI arg.
  // Falls back to last opened file when no explicit path is provided.
  useEffect(() => {
    const androidOpener = (window as unknown as Record<string, unknown>).__FileOpener__ as
      | { getPendingFile: () => string | null }
      | undefined;
    if (androidOpener) {
      const uri = androidOpener.getPendingFile();
      if (uri) { openFile(uri); return; }
    }

    const restoreLastFile = () => {
      const last = localStorage.getItem("mdeditor-last-file") ?? localStorage.getItem("md-editor-last-file");
      if (last) openFile(last);
    };

    invoke<string | null>("get_open_file_path").then((path) => {
      if (path) openFile(path);
      else restoreLastFile();
    }).catch(restoreLastFile);
  }, []);

  // Intercept all close events (toolbar button, Alt+F4, taskbar) to check unsaved state
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      if (fileState.saved) {
        await appWindow.destroy();
        return;
      }
      const confirmed = await ask(
        "当前文件有未保存的修改，确定要退出吗？",
        { title: "退出确认", kind: "warning" }
      );
      if (confirmed) await appWindow.destroy();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [fileState.saved]);

  // Listen for new file-open events while app is running
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<string>("open-file", (event) => {
      openFile(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [openFile]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "n") { e.preventDefault(); newFile(); }
      if (e.ctrlKey && !e.shiftKey && e.key === "o") { e.preventDefault(); openFile(); }
      if (e.ctrlKey && !e.shiftKey && e.key === "s") { e.preventDefault(); saveFile(); }
      if (e.ctrlKey && e.shiftKey && e.key === "S")  { e.preventDefault(); saveFileAs(); }
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        setViewMode((m) => m === "preview" ? "split" : "preview");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newFile, openFile, saveFile, saveFileAs]);

  const stats = useMemo(() => {
    const content = fileState.content;
    return {
      chars: content.length,
      lines: content.split("\n").length,
      words: content.trim() === "" ? 0 : content.trim().split(/\s+/).length,
    };
  }, [fileState.content]);

  return (
    <div className="app">
      <Toolbar
        fileName={fileState.name}
        saved={fileState.saved}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onNew={newFile}
        onOpen={() => openFile()}
        onSave={saveFile}
        onSaveAs={saveFileAs}
      />

      <div className="main-area">
        {(viewMode === "edit" || viewMode === "split") && (
          <div className={`pane editor-pane ${viewMode === "split" ? "split" : "full"}`}>
            <Suspense fallback={<div className="pane-loading" />}>
              <Editor content={fileState.content} onChange={setContent} onScroll={handleEditorScroll} scrollControlRef={editorScrollControlRef} />
            </Suspense>
          </div>
        )}

        {viewMode === "split" && <div className="split-divider" />}

        {(viewMode === "preview" || viewMode === "split") && (
          <div className={`pane preview-pane ${viewMode === "split" ? "split" : "full"}`}>
            <Suspense fallback={<div className="pane-loading" />}>
              <Preview content={fileState.content} filePath={fileState.path} onScroll={handlePreviewScroll} scrollControlRef={previewScrollControlRef} />
            </Suspense>
          </div>
        )}
      </div>

      <StatusBar
        charCount={stats.chars}
        lineCount={stats.lines}
        wordCount={stats.words}
        filePath={fileState.path}
      />
    </div>
  );
}
