import { Marked } from "marked";
import { convertFileSrc } from "@tauri-apps/api/core";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("json", json);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  })
);

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** 文件所在目录；content:// 之类没有真实目录的路径返回 null */
export const fileDir = (path: string | null): string | null =>
  path && /^([a-zA-Z]:[\\/]|\\\\)/.test(path) ? path.replace(/[\\/][^\\/]*$/, "") : null;

/** 去掉 ?query 和 #hash：它们不属于文件名，留着会拼进路径导致读不到文件 */
const splitSuffix = (url: string) => {
  const match = url.match(/^([^?#]*)([?#].*)?$/);
  return { path: match?.[1] ?? url, suffix: match?.[2] ?? "" };
};

/** Windows 盘符绝对路径，如 C:\a\b.png 或 C:/a/b.png */
const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;
/** 已经带协议的写法：https:、data:、asset:、blob:…；盘符不在此列，会先被 DRIVE_PATH 拦下 */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 反斜杠统一成正斜杠，asset: 地址里混用两种分隔符容易在 Windows 上翻车 */
const toForwardSlashes = (path: string) => path.replace(/\\/g, "/");

/**
 * 把正文里的本地图片路径解析成绝对路径。
 * 预览页的地址是 http://tauri.localhost/，相对路径会被解析到 WebView 自己身上，
 * 根本读不到磁盘，所以必须在这里按 Markdown 文件所在目录还原成绝对路径。
 * 返回 null 表示不是本地路径，调用方保持原样即可。
 */
function resolveLocalPath(url: string, baseDir: string | null): string | null {
  if (!baseDir) return null;

  const { path } = splitSuffix(url.trim());
  if (!path) return null;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // 含 % 但不是合法转义，按原样处理
  }

  const normalized = toForwardSlashes(decoded);
  const root = toForwardSlashes(baseDir).replace(/\/+$/, "");

  // Windows 绝对路径直接用
  if (DRIVE_PATH.test(decoded)) return normalized;

  // 协议相对地址 //host/x 交给 WebView 自己处理。
  // 必须排在单个 / 之前判断，否则会被当成盘符根目录拼成 D://host/x
  if (normalized.startsWith("//")) return null;

  // 以 / 开头视为盘符根目录：D: 盘下打开的文件里 /a.png 指 D:/a.png
  if (normalized.startsWith("/")) return `${root.slice(0, 2)}${normalized}`;

  return `${root}/${normalized}`;
}

/** 把正文里的本地资源路径转成 asset: 协议的地址，其余一律不碰 */
export function resolveLocalUrl(url: string, baseDir: string | null): string | null {
  // HTML 属性里的 & 会被 marked 转义成 &amp;，还原后再拼路径，否则文件名对不上
  const raw = url.trim().replace(/&amp;/g, "&");
  if (!raw || raw.startsWith("#")) return null;

  // ?query / #hash 不能进 convertFileSrc：会被百分号编码成文件名的一部分，
  // 变成去找一个叫 "pic.png?v=1" 的文件。必须转换完再拼回去
  const { suffix } = splitSuffix(raw);
  const toAsset = (path: string) => `${convertFileSrc(path)}${suffix}`;

  // 盘符要先于协议判断：C:\a.png 会被 URL_SCHEME 误认成协议
  if (URL_SCHEME.test(raw) && !DRIVE_PATH.test(raw)) {
    // file:// 是用户显式写的本地文件，转成 asset: 才能读
    if (!/^file:\/\//i.test(raw)) return null;
    const local = resolveLocalPath(raw.replace(/^file:\/\//i, "").replace(/^\/([a-zA-Z]:)/, "$1"), baseDir);
    return local ? toAsset(local) : null;
  }
  const path = resolveLocalPath(raw, baseDir);
  return path ? toAsset(path) : null;
}

/** 改写一段 HTML 里的 src(图片、音视频)，其余原样返回 */
function rewriteLocalUrls(html: string, baseDir: string | null): string {
  if (!baseDir) return html;
  // 双引号和单引号都覆盖：Markdown 图片语法固定输出双引号，
  // 但正文里手写的 <img src='…'> 可能是单引号
  return html.replace(
    /\ssrc=("([^"]*)"|'([^']*)')/g,
    (whole, _quoted: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
      const value = doubleQuoted ?? singleQuoted ?? "";
      const resolved = resolveLocalUrl(value, baseDir);
      // 结果写回属性，& 要重新转义
      return resolved ? ` src="${resolved.replace(/&/g, "&amp;")}"` : whole;
    }
  );
}

/** 顶层块在源码中的起始行 + 渲染后的 HTML，供右侧按源码行号对齐滚动 */
export interface MarkdownBlock {
  /** 1 起始的源码行号 */
  line: number;
  html: string;
}

/** 渲染结果：拼接后的完整 HTML + 每个顶层块的行号锚点 */
export interface RenderResult {
  html: string;
  blocks: MarkdownBlock[];
}

/**
 * 逐顶层块解析，给每块记录源码起始行号。
 * 不整体 parse：那样拿不到「某段 HTML 对应源码第几行」，滚动同步就只能退化成按比例估算。
 */
export function renderMarkdown(source: string, baseDir: string | null = null): RenderResult {
  const tokens = marked.lexer(source);
  // marked-highlight 的高亮挂在 walkTokens 钩子上，只有 marked.parse() 会自动调用；
  // 这里拆成 lexer + parser 两步，必须手动补跑，否则代码块全部没有高亮
  marked.walkTokens(tokens, marked.defaults.walkTokens ?? (() => {}));
  const blocks: MarkdownBlock[] = [];
  const htmlParts: string[] = [];
  let consumed = 0;

  for (const token of tokens) {
    const line = 1 + countNewlines(source.slice(0, consumed));
    consumed += token.raw.length;

    // space / def 不产生可见内容，跳过但保留消费长度，否则后续块行号会整体偏移
    if (token.type === "space" || token.type === "def") continue;

    // 在最终 HTML 上改写，Markdown 图片语法和正文里手写的 <img src> 一并覆盖
    const html = rewriteLocalUrls(marked.parser([token]), baseDir);
    blocks.push({ line, html });
    htmlParts.push(html);
  }

  return { html: htmlParts.join(""), blocks };
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}
