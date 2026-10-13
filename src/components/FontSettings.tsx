import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useFonts, BUILTIN_CJK, BUILTIN_LATIN, buildFontStack } from "../context/FontContext";
import "./FontSettings.css";

interface SystemFont {
  family: string;
  label: string;
  cjk: boolean;
}

// 系统字体列表在一次运行期间基本不变，缓存起来，重复打开对话框不再枚举
let fontListCache: Promise<SystemFont[]> | null = null;
const loadSystemFonts = () => {
  fontListCache ??= invoke<SystemFont[]>("list_system_fonts").catch((e) => {
    fontListCache = null;
    throw e;
  });
  return fontListCache;
};

const optionText = (font: SystemFont) =>
  font.label === font.family ? font.family : `${font.label}（${font.family}）`;

const PREVIEW_TEXT = "春眠不觉晓，处处闻啼鸟。The quick brown fox 0123456789 {}[]=>";

export default function FontSettings({ onClose }: { onClose: () => void }) {
  const { fonts, setFonts } = useFonts();
  const [systemFonts, setSystemFonts] = useState<SystemFont[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSystemFonts()
      .then(setSystemFonts)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 有中文名的(微软雅黑、楷体…)排前面，比 MS Gothic 之类更可能是想要的
  const cjkFonts = (systemFonts?.filter((font) => font.cjk) ?? []).sort(
    (a, b) => Number(b.label !== b.family) - Number(a.label !== a.family)
  );
  const allFonts = systemFonts ?? [];

  // 已保存的字体若被卸载，列表里找不到它，仍保留一项显示，免得下拉框显示错位
  const missing = (value: string | null, list: SystemFont[]) =>
    systemFonts && value && !list.some((font) => font.family === value) ? value : null;
  const missingCjk = missing(fonts.cjk, cjkFonts);
  const missingLatin = missing(fonts.latin, allFonts);

  return createPortal(
    <div className="font-dialog-mask" onMouseDown={onClose}>
      <div className="font-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="font-dialog-title">字体设置</div>

        <label className="font-field">
          <span>中文字体</span>
          <select
            value={fonts.cjk ?? ""}
            onChange={(e) => setFonts({ ...fonts, cjk: e.target.value || null })}
          >
            <option value="">霞鹜文楷 Mono（内置）</option>
            {missingCjk && <option value={missingCjk}>{missingCjk}（未找到）</option>}
            {cjkFonts.map((font) => (
              <option key={font.family} value={font.family}>{optionText(font)}</option>
            ))}
          </select>
        </label>

        <label className="font-field">
          <span>西文字体</span>
          <select
            value={fonts.latin ?? ""}
            onChange={(e) => setFonts({ ...fonts, latin: e.target.value || null })}
          >
            <option value="">Maple Mono（内置）</option>
            {missingLatin && <option value={missingLatin}>{missingLatin}（未找到）</option>}
            {allFonts.map((font) => (
              <option key={font.family} value={font.family}>{optionText(font)}</option>
            ))}
          </select>
        </label>

        <div className="font-hint">
          {error
            ? `读取系统字体失败：${error}`
            : !systemFonts
              ? "正在读取系统字体…"
              : allFonts.length === 0
                ? "当前平台不支持使用系统字体，仅可使用内置字体"
                : `共 ${allFonts.length} 个系统字体，其中 ${cjkFonts.length} 个含中文。若西文字体自带汉字，中文也会用它显示`}
        </div>

        <div className="font-preview" style={{ fontFamily: buildFontStack(fonts) }}>
          {PREVIEW_TEXT}
        </div>

        <div className="font-dialog-actions">
          <button
            type="button"
            className="font-btn"
            onClick={() => setFonts({ cjk: null, latin: null })}
            disabled={fonts.cjk === null && fonts.latin === null}
          >
            恢复默认（{BUILTIN_CJK} + {BUILTIN_LATIN}）
          </button>
          <button type="button" className="font-btn primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
