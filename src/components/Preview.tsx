import { useEffect, useRef, useMemo, useDeferredValue, type MutableRefObject, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown, fileDir } from "../lib/markdown";
import { useTheme } from "../context/ThemeContext";
import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github.css";
import "./Preview.css";

/** 预览侧锚点：源码行号 ↔ 该块在滚动坐标系中的纵向位置 */
interface PreviewAnchor {
  line: number;
  top: number;
}

interface PreviewProps {
  content: string;
  /** 当前文件路径，用于把正文里的相对图片路径解析成绝对路径 */
  filePath?: string | null;
  /** 上报视口顶部位置：整数为源码行号，小数为块内比例 */
  onScroll?: (line: number) => void;
  /** 接收来自编辑器的定位请求 */
  scrollControlRef?: MutableRefObject<((line: number) => void) | null>;
}

/** 锚点范围之外(文档首尾)的估算行高，仅兜底用，正常路径不会走到 */
const LINE_HEIGHT_FALLBACK = 27;
/** 程序化滚动后，等待回声事件的超时；超时未等到就清除，避免误吞用户的真实滚动 */
const ECHO_TIMEOUT_MS = 200;

export default function Preview({ content, filePath, onScroll, scrollControlRef }: PreviewProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onScrollRef = useRef(onScroll);
  useEffect(() => { onScrollRef.current = onScroll; }, [onScroll]);

  // 预览滞后于输入渲染：连续打字时 React 会丢弃过时的中间版本，
  // 避免每个按键都全文解析 + 高亮，减少 CPU 和临时内存分配
  const deferredContent = useDeferredValue(content);
  // 用文件所在目录做基准，换文件时基准跟着变，图片要重新解析
  const baseDir = fileDir(filePath ?? null);
  const { blocks, html } = useMemo(
    () => renderMarkdown(deferredContent, baseDir),
    [deferredContent, baseDir]
  );

  const anchorsRef = useRef<PreviewAnchor[]>([]);
  // 记录自己写入的滚动位置，用于识别随后到来的回声事件
  const echoRef = useRef<{ top: number; timer: number } | null>(null);

  // 测量各块位置。字体加载、图片撑开高度都会改变布局，所以要能反复调用
  const measureAnchors = () => {
    const scroller = containerRef.current;
    const contentEl = contentRef.current;
    if (!scroller || !contentEl) return;

    // 用「元素在视口里的位置 + 当前已滚动量」还原到滚动坐标系，
    // 这样不管此刻滚到哪儿，测出来的都是相对内容顶部的位置
    const scrollerTop = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const anchors: PreviewAnchor[] = [];
    const elements = contentEl.querySelectorAll<HTMLElement>("[data-line]");
    for (const el of elements) {
      const line = Number(el.dataset.line);
      if (!Number.isFinite(line)) continue;
      anchors.push({ line, top: el.getBoundingClientRect().top - scrollerTop });
    }
    anchors.sort((a, b) => a.line - b.line);
    anchorsRef.current = anchors;
  };

  const lineToScrollTop = (line: number): number => {
    const anchors = anchorsRef.current;
    if (anchors.length === 0) return 0;

    // 首尾之外按估算行高外推，锚点之间按比例插值，
    // 使长代码块、大表格内部的滚动也连续，不会整块跳
    if (line <= anchors[0].line) {
      return anchors[0].top - (anchors[0].line - line) * LINE_HEIGHT_FALLBACK;
    }
    for (let i = 0; i < anchors.length - 1; i++) {
      const current = anchors[i];
      const next = anchors[i + 1];
      if (line < next.line) {
        const span = next.line - current.line;
        const ratio = span > 0 ? (line - current.line) / span : 0;
        return current.top + (next.top - current.top) * ratio;
      }
    }
    const last = anchors[anchors.length - 1];
    return last.top + (line - last.line) * LINE_HEIGHT_FALLBACK;
  };

  const scrollTopToLine = (scrollTop: number): number => {
    const anchors = anchorsRef.current;
    if (anchors.length === 0) return 1;

    if (scrollTop <= anchors[0].top) {
      return anchors[0].line + (scrollTop - anchors[0].top) / LINE_HEIGHT_FALLBACK;
    }
    for (let i = 0; i < anchors.length - 1; i++) {
      const current = anchors[i];
      const next = anchors[i + 1];
      if (scrollTop < next.top) {
        const span = next.top - current.top;
        const ratio = span > 0 ? (scrollTop - current.top) / span : 0;
        return current.line + (next.line - current.line) * ratio;
      }
    }
    const last = anchors[anchors.length - 1];
    return last.line + (scrollTop - last.top) / LINE_HEIGHT_FALLBACK;
  };

  useEffect(() => {
    const scroller = containerRef.current;
    const contentEl = contentRef.current;
    if (!scroller || !contentEl) return;

    measureAnchors();

    const handleScroll = () => {
      // 回声判断：位置和自己刚写进去的一致，说明这次滚动是上面驱动的，不再往回上报，
      // 否则两侧会互相驱动形成抖动
      const echo = echoRef.current;
      if (echo) {
        if (Math.abs(scroller.scrollTop - echo.top) < 1.5) {
          window.clearTimeout(echo.timer);
          echoRef.current = null;
          return;
        }
        window.clearTimeout(echo.timer);
        echoRef.current = null;
      }
      onScrollRef.current?.(scrollTopToLine(scroller.scrollTop));
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });

    if (scrollControlRef) {
      scrollControlRef.current = (line: number) => {
        scroller.scrollTop = lineToScrollTop(line);
        // 记下实际生效的位置(可能被边界截断)，供回声判断比对
        const timer = window.setTimeout(() => { echoRef.current = null; }, ECHO_TIMEOUT_MS);
        echoRef.current = { top: scroller.scrollTop, timer };
      };
    }

    // 布局变化(图片载入、字体切换、窗口缩放)都会让锚点过期，重测
    const observer = new ResizeObserver(() => { measureAnchors(); });
    observer.observe(contentEl);

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      observer.disconnect();
      const echo = echoRef.current;
      if (echo) window.clearTimeout(echo.timer);
      echoRef.current = null;
      if (scrollControlRef) scrollControlRef.current = null;
    };
  }, []);

  // 换内容要重测锚点，否则会按上一个文件的高度定位
  useEffect(() => {
    measureAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // WebView 默认会在窗口内跳转到链接页面，整个编辑器被替换掉且回不来，
  // 所以一律拦截：外部链接交给系统浏览器，页内锚点自己滚动
  const handleLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || !href) return;
    event.preventDefault();

    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      document.getElementById(id)?.scrollIntoView({ block: "start" });
      return;
    }
    // 只放行这几种协议，避免文档里的 file:、javascript: 之类链接被拿去执行
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      openUrl(href).catch((e) => console.error("打开链接失败:", e));
    }
  };

  return (
    <div className="preview-wrapper" ref={containerRef} data-theme={theme}>
      <div
        className="markdown-body preview-content"
        ref={contentRef}
        data-color-mode={theme}
        onClick={handleLinkClick}
        onAuxClick={handleLinkClick}
      >
        {blocks.map((block, index) => (
          <div
            key={`${block.line}-${index}`}
            className="md-block"
            data-line={block.line}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ))}
      </div>
    </div>
  );
}
