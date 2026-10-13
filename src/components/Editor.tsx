import { useEffect, useRef, type MutableRefObject } from "react";
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { useTheme } from "../context/ThemeContext";
import { useFonts } from "../context/FontContext";
import "./Editor.css";

interface EditorProps {
  content: string;
  onChange: (value: string) => void;
  /** 上报视口顶部位置：整数为行号，小数为行内比例(0~1) */
  onScroll?: (line: number) => void;
  /** 接收外部定位请求（来自预览的行号，可为小数） */
  scrollControlRef?: MutableRefObject<((line: number) => void) | null>;
}

const UI_FONT = "var(--font-ui)";
const CODE_FONT = "var(--font-code)";

const darkTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "15px",
      fontFamily: UI_FONT,
      background: "#1e1e1e",
      color: "#d4d4d4",
    },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.8", fontFamily: UI_FONT },
    ".cm-content": { padding: "16px 0", caretColor: "#aeafad", minHeight: "100%", fontFamily: UI_FONT },
    // 水平留白必须放在 .cm-line 上：CodeMirror 画整行选区时左右边界按
    // 「.cm-content 外框 + .cm-line 内边距」算，不认 .cm-content 自身的内边距，
    // 放在 content 上会让中间行的选区比首行多伸出一截，框选拼不成整齐的矩形
    ".cm-line": { fontFamily: UI_FONT, padding: "0 20px" },
    ".cm-cursor": { borderLeftColor: "#aeafad" },
    ".cm-gutters": {
      background: "#1e1e1e",
      color: "#6e6e6e",
      border: "none",
      borderRight: "1px solid #3e3e42",
      paddingRight: "8px",
      fontFamily: CODE_FONT,
      fontSize: "13px",
    },
    ".cm-activeLineGutter": { background: "#2a2d2e", color: "#d4d4d4" },
    // 选区图层在行背景之下(CodeMirror 刻意如此，抬上去会盖住文字)，
    // 所以活动行的背景色一叠上去就把选区压没了。有选区时干脆不画活动行背景，
    // 选区自然透出来。:has 的兼容性对桌面端(WebView2/WebKit)足够
    ".cm-activeLine": { background: "#2a2d2e" },
    "&:has(.cm-selectionBackground) .cm-activeLine": { background: "transparent" },
    // 选择器要写成和 baseTheme 同一条链：baseTheme 用的是
    // `.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`，
    // 只在末尾挂 .cm-selectionBackground 会因特定性不足(0,2,0 < 0,4,0)被它压掉
    ".cm-selectionBackground": { background: "#264f78" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "#264f78" },
    "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "#264f78" },
    ".cm-matchingBracket": { background: "#3b514d", outline: "1px solid #888" },
    "&.cm-focused": { outline: "none" },
    // 代码块内用等宽字体
    ".ͼ1 .tok-monospace, .cm-content code": { fontFamily: CODE_FONT },
  },
  { dark: true }
);

const lightTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "15px",
      fontFamily: UI_FONT,
      background: "#ffffff",
      color: "#1f1f1f",
    },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.8", fontFamily: UI_FONT },
    ".cm-content": { padding: "16px 0", caretColor: "#333", minHeight: "100%", fontFamily: UI_FONT },
    ".cm-line": { fontFamily: UI_FONT, padding: "0 20px" },
    ".cm-cursor": { borderLeftColor: "#333" },
    ".cm-gutters": {
      background: "#f8f8f8",
      color: "#aaaaaa",
      border: "none",
      borderRight: "1px solid #e0e0e0",
      paddingRight: "8px",
      fontFamily: CODE_FONT,
      fontSize: "13px",
    },
    ".cm-activeLineGutter": { background: "#eff1f7", color: "#333" },
    ".cm-activeLine": { background: "#eff1f7" },
    // 同 dark：有选区时让出活动行背景，否则会把下方的选区高亮压掉
    "&:has(.cm-selectionBackground) .cm-activeLine": { background: "transparent" },
    // 同 dark：必须比 baseTheme 那条链的特定性更高才生效
    ".cm-selectionBackground": { background: "#b5d5fb" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "#b5d5fb" },
    "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { background: "#b5d5fb" },
    ".cm-matchingBracket": { background: "#d8f0d8", outline: "1px solid #aaa" },
    "&.cm-focused": { outline: "none" },
    ".ͼ1 .tok-monospace, .cm-content code": { fontFamily: CODE_FONT },
  },
  { dark: false }
);

const themeCompartment = new Compartment();

/** 程序化滚动后等待回声事件的超时；超时未等到就清除，避免误吞用户的真实滚动 */
const ECHO_TIMEOUT_MS = 200;

export default function Editor({ content, onChange, onScroll, scrollControlRef }: EditorProps) {
  const { theme } = useTheme();
  const { fonts } = useFonts();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onScrollRef = useRef(onScroll);
  useEffect(() => { onScrollRef.current = onScroll; }, [onScroll]);
  // 记录自己写入的滚动位置，用于识别随后到来的回声事件
  const echoRef = useRef<{ top: number; timer: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          bracketMatching(),
          history(),
          autocompletion(),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          themeCompartment.of(darkTheme),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
          EditorView.lineWrapping,
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    const scrollDOM = view.scrollDOM;

    // CodeMirror 的坐标以文档顶部为原点，scrollDOM.scrollTop 以滚动容器为原点，
    // 两者相差一个上 padding，换算时必须补上，否则会整体偏移若干像素
    const paddingTop = () => view.documentPadding.top;

    const handleScroll = () => {
      // 回声判断：位置与刚写进去的一致，说明这次滚动是对侧驱动的，不再往回上报，
      // 否则两侧会互相驱动形成抖动
      const echo = echoRef.current;
      if (echo) {
        window.clearTimeout(echo.timer);
        echoRef.current = null;
        if (Math.abs(scrollDOM.scrollTop - echo.top) < 1.5) return;
      }
      const height = Math.max(0, scrollDOM.scrollTop - paddingTop());
      const block = view.lineBlockAtHeight(height);
      const lineNumber = view.state.doc.lineAt(block.from).number;
      const ratio = block.height > 0 ? (height - block.top) / block.height : 0;
      onScrollRef.current?.(lineNumber + Math.min(1, Math.max(0, ratio)));
    };
    scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    if (scrollControlRef) {
      scrollControlRef.current = (line: number) => {
        const safeLine = Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines);
        const fraction = Math.min(1, Math.max(0, line - Math.floor(line)));
        const lineInfo = view.state.doc.line(safeLine);
        const block = view.lineBlockAt(lineInfo.from);
        // 行内比例用于块内定位（长代码块等），行高一致时退化为行首对齐
        scrollDOM.scrollTop = Math.max(0, block.top + paddingTop() + block.height * fraction);
        // 记下实际生效的位置(可能被边界截断)，供回声判断比对
        const timer = window.setTimeout(() => { echoRef.current = null; }, ECHO_TIMEOUT_MS);
        echoRef.current = { top: scrollDOM.scrollTop, timer };
      };
    }

    return () => {
      scrollDOM.removeEventListener("scroll", handleScroll);
      const echo = echoRef.current;
      if (echo) window.clearTimeout(echo.timer);
      echoRef.current = null;
      if (scrollControlRef) scrollControlRef.current = null;
      view.destroy();
    };
  }, []);

  // 动态切换编辑器主题
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(theme === "dark" ? darkTheme : lightTheme),
    });
  }, [theme]);

  // 换字体后字宽、行高都变了，CodeMirror 缓存的高度表会错位(光标、点击位置偏移)，
  // 要等新字体真正加载完再让它重测
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) viewRef.current?.requestMeasure();
    });
    return () => { cancelled = true; };
  }, [fonts]);

  // 同步外部内容（打开文件、外部修改热加载等）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc === content) return;

    // 只替换首尾公共部分之间的差异段：整篇替换会把光标甩到文末、滚动位置丢失，
    // 外部改了一个字也像重新打开了文件
    let start = 0;
    const minLength = Math.min(currentDoc.length, content.length);
    while (start < minLength && currentDoc.charCodeAt(start) === content.charCodeAt(start)) start++;
    let oldEnd = currentDoc.length;
    let newEnd = content.length;
    while (oldEnd > start && newEnd > start && currentDoc.charCodeAt(oldEnd - 1) === content.charCodeAt(newEnd - 1)) {
      oldEnd--;
      newEnd--;
    }
    view.dispatch({
      changes: { from: start, to: oldEnd, insert: content.slice(start, newEnd) },
    });
  }, [content]);

  return (
    <div className="editor-wrapper">
      <div ref={containerRef} className="editor-container" />
    </div>
  );
}
