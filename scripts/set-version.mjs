// 按发布标签写入各处版本号。用法：node scripts/set-version.mjs v2026.10.13
// CI 构建前和本地发版都调用它，保证 package.json / tauri.conf.json / Cargo.toml 三处一致
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
const match = tag.match(/^v(\d{4})\.(\d{2})\.(\d{2})$/);
if (!match) {
  console.error(`标签格式应为 vYYYY.MM.DD，例如 v2026.10.13，实际收到：${tag || "(空)"}`);
  process.exit(1);
}

const [year, month, day] = match.slice(1).map(Number);
if (month < 1 || month > 12 || day < 1 || day > 31) {
  console.error(`日期不合法：${tag}`);
  process.exit(1);
}

// semver 不允许前导零：v2026.01.05 内部写作 2026.1.5
const version = `${year}.${month}.${day}`;
// MSI 主、次版本号上限 255，2026 会直接构建失败，年份减 2000 后再用
const msiVersion = `${year - 2000}.${month}.${day}`;

const editJson = (path, edit) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};

editJson("package.json", (pkg) => {
  pkg.version = version;
});

editJson("src-tauri/tauri.conf.json", (conf) => {
  conf.version = version;
  conf.bundle.windows ??= {};
  conf.bundle.windows.wix = { ...conf.bundle.windows.wix, version: msiVersion };
});

// 只改 [package] 段的第一个 version，依赖里的 version 不能动
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const patched = cargo.replace(/^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
if (patched === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error("没能在 Cargo.toml 的 [package] 段找到 version");
  process.exit(1);
}
writeFileSync(cargoPath, patched);

console.log(`版本号：${version}（MSI：${msiVersion}）`);

// 在 GitHub Actions 里把结果交给后续步骤
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nmsi_version=${msiVersion}\n`);
}
