// 发布新版本：写入版本号 → 提交 → 打标签 → 推送，推送标签后由 GitHub Actions 自动构建并发布。
// 用法：
//   node scripts/release.mjs              以今天的日期发版，例如 v2026.10.13
//   node scripts/release.mjs v2026.10.13  指定标签
// 发版前要先写好更新日志 .github/release-notes/<标签>.md，它会原样成为 Release 正文
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...options }).trim();

const today = new Date();
const pad = (n) => String(n).padStart(2, "0");
const tag = process.argv[2] ?? `v${today.getFullYear()}.${pad(today.getMonth() + 1)}.${pad(today.getDate())}`;

const notes = `.github/release-notes/${tag}.md`;
if (!existsSync(notes)) {
  console.error(`缺少更新日志：${notes}\n先写好它再发版（可参考已有的日志格式）`);
  process.exit(1);
}

if (run("git", ["tag", "--list", tag])) {
  console.error(`标签 ${tag} 已存在。版本号按日期生成，同一天只能发一个版本`);
  process.exit(1);
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  console.error(`当前在 ${branch} 分支，请切回 main 再发版`);
  process.exit(1);
}

// 只允许更新日志本身是未提交状态，其余改动要先提交，免得把半成品打进版本
const dirty = run("git", ["status", "--porcelain"])
  .split("\n")
  .filter((line) => line && !line.endsWith(notes) && !line.endsWith("blog.md"));
if (dirty.length > 0) {
  console.error(`工作区有未提交的改动，请先处理：\n${dirty.join("\n")}`);
  process.exit(1);
}

execFileSync("node", ["scripts/set-version.mjs", tag], { stdio: "inherit" });
// Cargo.lock 里记录着本包版本，同步刷新，不联网
execFileSync("cargo", ["metadata", "--format-version", "1", "--offline", "--manifest-path", "src-tauri/Cargo.toml"], {
  stdio: ["ignore", "ignore", "inherit"],
});

run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", notes]);
run("git", ["commit", "-m", `release: ${tag}`]);
run("git", ["tag", "-a", tag, "-m", `MDEditor ${tag}`]);
execFileSync("git", ["push", "origin", "main", tag], { stdio: "inherit" });

console.log(`\n已推送 ${tag}，构建进度：https://github.com/shumengya/MDEditer/actions`);
