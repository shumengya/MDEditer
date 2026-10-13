import { useRef, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "../context/ThemeContext";
import FontSettings from "./FontSettings";
import "./Toolbar.css";

export type ViewMode = "edit" | "split" | "preview";

interface ToolbarProps {
  fileName: string;
  saved: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

export default function Toolbar({
  fileName,
  saved,
  viewMode,
  onViewModeChange,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
}: ToolbarProps) {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [fontDialogOpen, setFontDialogOpen] = useState(false);
  // 版本号由发布流程按日期写入 tauri.conf.json，这里运行时读取，不再写死
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [menuOpen]);

  const handleMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  const runWindowAction = (action: () => Promise<void>) => {
    action().catch((err) => console.error("窗口操作失败:", err));
  };

  return (
    <div className="toolbar" data-tauri-drag-region>
      {/* 左区 — 无 data-tauri-drag-region，依靠 CSS no-drag 覆盖 */}
      <div className="toolbar-left">
        <div className="app-logo">
          <img src="/logo.svg" alt="MDEditor" width={18} height={18} />
        </div>
        <div className="toolbar-group">
          <button type="button" className="tb-btn tb-btn-new" onClick={onNew} title="新建 (Ctrl+N)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <span>新建</span>
          </button>
          <button className="tb-btn" onClick={onOpen} title="打开 (Ctrl+O)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>打开</span>
          </button>
          <button className="tb-btn tb-btn-save" onClick={onSave} title="保存 (Ctrl+S)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" />
            </svg>
            <span>保存</span>
          </button>
          <button className="tb-btn tb-btn-saveas" onClick={onSaveAs} title="另存为 (Ctrl+Shift+S)">
            <span>另存为</span>
          </button>
        </div>
      </div>

      <div className="toolbar-center">
        <span
          className={`file-name ${saved ? "" : "unsaved"}`}
          data-tauri-drag-region
        >
          {saved ? "" : "● "}{fileName}
        </span>
      </div>

      <div className="toolbar-right">
        <div className="view-toggle">
          <button className={`view-btn ${viewMode === "edit" ? "active" : ""}`} onClick={() => onViewModeChange("edit")} title="仅编辑">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16,18 22,12 16,6" /><polyline points="8,6 2,12 8,18" />
            </svg>
            <span className="view-btn-label">编辑</span>
          </button>
          <button className={`view-btn view-btn-split ${viewMode === "split" ? "active" : ""}`} onClick={() => onViewModeChange("split")} title="分屏视图">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            <span className="view-btn-label">分屏</span>
          </button>
          <button className={`view-btn ${viewMode === "preview" ? "active" : ""}`} onClick={() => onViewModeChange("preview")} title="仅预览">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
            </svg>
            <span className="view-btn-label">预览</span>
          </button>
        </div>

        {/* 三点更多菜单 */}
        <div className="more-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`tb-icon-btn ${menuOpen ? "active" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setMenuOpen((v) => !v);
            }}
            title="更多选项"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>

          {menuOpen && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={() => handleMenuAction(toggleTheme)}>
                {theme === "dark" ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                    切换浅色模式
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    切换深色模式
                  </>
                )}
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-item" onClick={() => handleMenuAction(() => setFontDialogOpen(true))}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4,7 4,4 20,4 20,7" />
                  <line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                字体设置
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-item" onClick={() => handleMenuAction(onNew)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                新建文件
                <span className="dropdown-shortcut">Ctrl+N</span>
              </button>
              <button className="dropdown-item" onClick={() => handleMenuAction(onOpen)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                打开文件
                <span className="dropdown-shortcut">Ctrl+O</span>
              </button>
              <button className="dropdown-item" onClick={() => handleMenuAction(onSave)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" />
                </svg>
                保存
                <span className="dropdown-shortcut">Ctrl+S</span>
              </button>
              <button className="dropdown-item" onClick={() => handleMenuAction(onSaveAs)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" />
                </svg>
                另存为
                <span className="dropdown-shortcut">Ctrl+Shift+S</span>
              </button>
              <div className="dropdown-separator" />
              <button
                className="dropdown-item"
                onClick={() =>
                  handleMenuAction(() => {
                    invoke<string>("register_file_associations")
                      .then((msg) => alert(msg))
                      .catch((e) => alert("注册失败: " + e));
                  })
                }
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                </svg>
                设为默认打开方式
              </button>
              <div className="dropdown-separator" />
              <div className="dropdown-version">MDEditor{version && ` v${version}`}</div>
            </div>
          )}
        </div>

        <div className="window-controls">
          <button
            type="button"
            className="wc-btn minimize"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => runWindowAction(() => getCurrentWindow().minimize())}
            title="最小化"
          />
          <button
            type="button"
            className="wc-btn maximize"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => runWindowAction(() => getCurrentWindow().toggleMaximize())}
            title="最大化"
          />
          <button
            type="button"
            className="wc-btn close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => runWindowAction(() => getCurrentWindow().close())}
            title="关闭"
          />
        </div>
      </div>
      {fontDialogOpen && <FontSettings onClose={() => setFontDialogOpen(false)} />}
    </div>
  );
}
