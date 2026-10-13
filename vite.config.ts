import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CODEMIRROR_CORE = [
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@codemirror/commands",
  "@codemirror/search",
  "@codemirror/autocomplete",
  "@codemirror/lang-markdown",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  "@lezer/markdown",
];

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          // 只把编辑器核心打进公共块。各语言包(lang-*、legacy-modes、@lezer/<语言>)
          // 由 language-data 按需 import()，若也塞进这里，就会在启动时被整块加载解析，
          // 上百种语言的解析器常驻内存
          if (CODEMIRROR_CORE.some((pkg) => id.includes(`node_modules/${pkg}/`))) {
            return "vendor-codemirror";
          }
          if (id.includes("node_modules/highlight.js/") || id.includes("node_modules/marked")) {
            return "vendor-markdown";
          }
        },
      },
    },
  },
}));
