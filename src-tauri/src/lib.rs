use std::sync::Mutex;
use tauri::{Manager, State, WindowEvent};

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入失败: {}", e))
}

/// 当前被监听的文件。替换或置空时旧 watcher 被 drop，监听随之停止
#[cfg(desktop)]
#[derive(Default)]
struct FileWatcher(Mutex<Option<notify::RecommendedWatcher>>);

#[cfg(desktop)]
#[tauri::command]
fn watch_file(app: tauri::AppHandle, state: State<FileWatcher>, path: String) -> Result<(), String> {
    use notify::{EventKind, RecursiveMode, Watcher};
    use tauri::Emitter;

    let target = std::path::PathBuf::from(&path);
    let dir = target.parent().ok_or("无效的文件路径")?.to_path_buf();
    let file_name = target
        .file_name()
        .ok_or("无效的文件路径")?
        .to_string_lossy()
        .into_owned();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            return;
        }
        // Windows 文件名不区分大小写，用户传入的路径大小写可能和磁盘上不一致
        let hit = event.paths.iter().any(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&file_name))
        });
        if hit {
            let _ = app.emit("file-changed", path.clone());
        }
    })
    .map_err(|e| format!("创建文件监听失败: {}", e))?;

    // 监听父目录而不是文件本身：VS Code 等编辑器保存时先写临时文件再改名覆盖，
    // 直接盯文件的话第一次被替换后就再也收不到事件了
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("监听目录失败: {}", e))?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn unwatch_file(state: State<FileWatcher>) {
    *state.0.lock().unwrap() = None;
}

// 移动端打开的是 content:// 虚拟路径，没有可监听的真实文件
#[cfg(mobile)]
#[tauri::command]
fn watch_file(path: String) -> Result<(), String> {
    let _ = path;
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
fn unwatch_file() {}

/// 最小化时让 WebView2 进入低内存模式(回收缓存、压缩工作集)，还原后调回正常。
/// 可见状态下不用 Low：页面会因频繁换页变卡
#[cfg(windows)]
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    static LOW_MEMORY: AtomicBool = AtomicBool::new(false);

    if !matches!(event, WindowEvent::Resized(_)) {
        return;
    }
    let minimized = window.is_minimized().unwrap_or(false);
    // 拖动缩放时 Resized 会连发，只在最小化状态翻转时才去调 COM
    if LOW_MEMORY.swap(minimized, Ordering::Relaxed) == minimized {
        return;
    }
    let Some(webview) = window.get_webview_window(window.label()) else { return };
    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else { return };
        // WebView2 Runtime 低于 114 没有 _19 接口，拿不到就跳过
        let Ok(core19) = core.cast::<ICoreWebView2_19>() else { return };
        let level = if minimized {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let _ = core19.SetMemoryUsageTargetLevel(level);
    });
}

#[cfg(not(windows))]
fn handle_window_event(_window: &tauri::Window, _event: &WindowEvent) {}

/// 系统字体族。family 用英文名，作为 CSS font-family 最稳；label 优先中文本地化名
#[derive(serde::Serialize)]
struct SystemFont {
    family: String,
    label: String,
    /// 是否含常用汉字，前端据此筛出「中文字体」候选
    cjk: bool,
}

#[cfg(windows)]
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    use windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection, IDWriteLocalizedStrings,
        DWRITE_FACTORY_TYPE_SHARED,
    };
    use windows_core::{BOOL, HSTRING};

    unsafe fn localized(names: &IDWriteLocalizedStrings, locale: &str) -> Option<String> {
        let mut index = 0u32;
        let mut exists = BOOL(0);
        names
            .FindLocaleName(&HSTRING::from(locale), &mut index, &mut exists)
            .ok()?;
        if !exists.as_bool() {
            return None;
        }
        let length = names.GetStringLength(index).ok()?;
        let mut buffer = vec![0u16; length as usize + 1];
        names.GetString(index, &mut buffer).ok()?;
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }

    // DirectWrite 枚举几百个字体要几十毫秒，async 命令跑在后台线程，不卡界面
    unsafe {
        let factory: IDWriteFactory =
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).map_err(|e| e.to_string())?;
        let mut collection: Option<IDWriteFontCollection> = None;
        factory
            .GetSystemFontCollection(&mut collection, false)
            .map_err(|e| e.to_string())?;
        let collection = collection.ok_or("获取系统字体失败")?;

        let mut fonts = Vec::new();
        for i in 0..collection.GetFontFamilyCount() {
            let Ok(family) = collection.GetFontFamily(i) else { continue };
            let Ok(names) = family.GetFamilyNames() else { continue };
            // 没有 en-us 名的字体退而取第一个名字
            let Some(english) = localized(&names, "en-us").or_else(|| {
                let length = names.GetStringLength(0).ok()?;
                let mut buffer = vec![0u16; length as usize + 1];
                names.GetString(0, &mut buffer).ok()?;
                Some(String::from_utf16_lossy(&buffer[..length as usize]))
            }) else {
                continue;
            };
            // @ 开头的是竖排专用字体，不能用于正常排版
            if english.starts_with('@') {
                continue;
            }
            let label = localized(&names, "zh-cn").unwrap_or_else(|| english.clone());
            // 用「中」字判断是否含汉字
            let cjk = family
                .GetFont(0)
                .and_then(|font| font.HasCharacter('中' as u32))
                .is_ok_and(|has| has.as_bool());
            fonts.push(SystemFont { family: english, label, cjk });
        }
        fonts.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
        Ok(fonts)
    }
}

// 移动端 WebView 无法使用任意系统字体，只提供内置字体
#[cfg(not(windows))]
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    Ok(Vec::new())
}

// ===== Windows 文件关联 =====
// 关键点：只往 .md\shell 下写右键菜单项是不够的，那只是「打开方式」里的一个菜单项，
// 跟默认打开方式无关。要让双击生效，必须注册一个真正的 ProgID，
// 再让扩展名的默认值指向它

#[cfg(target_os = "windows")]
const PROG_ID: &str = "MDEditor.md";
#[cfg(target_os = "windows")]
const CLASSES: &str = "HKCU\\Software\\Classes";
/// 右键菜单显示名，同时用作菜单项的键名
#[cfg(target_os = "windows")]
const VERB_NAME: &str = "使用 MDEditor 打开";

#[cfg(target_os = "windows")]
fn reg(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("reg")
        .args(args)
        .output()
        .map_err(|e| format!("调用 reg 失败: {}", e))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "reg {} 失败: {}",
        args.first().copied().unwrap_or(""),
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn register_file_associations() -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().to_string();
    let open_command = format!("\"{}\" \"%1\"", exe_str);
    let icon = format!("{},0", exe_str);

    // 1. 注册 ProgID：默认打开方式、图标、双击后执行的命令都挂在这里
    let prog_key = format!("{}\\{}", CLASSES, PROG_ID);
    reg(&["add", &prog_key, "/ve", "/d", "Markdown 文档", "/f"])?;
    reg(&["add", &format!("{}\\DefaultIcon", prog_key), "/ve", "/d", &icon, "/f"])?;
    reg(&[
        "add",
        &format!("{}\\shell\\open\\command", prog_key),
        "/ve",
        "/d",
        &open_command,
        "/f",
    ])?;

    for ext in [".md", ".markdown"] {
        let ext_key = format!("{}\\{}", CLASSES, ext);
        // 2. 扩展名默认值指向 ProgID，双击时找的就是它
        reg(&["add", &ext_key, "/ve", "/d", PROG_ID, "/f"])?;
        reg(&[
            "add",
            &format!("{}\\OpenWithProgids", ext_key),
            "/v",
            PROG_ID,
            "/t",
            "REG_NONE",
            "/f",
        ])?;

        // 3. 右键菜单项。旧版本只做了这一步，所以一直没成为默认打开方式
        reg(&[
            "add",
            &format!("{}\\shell\\{}", ext_key, VERB_NAME),
            "/ve",
            "/d",
            VERB_NAME,
            "/f",
        ])?;
        reg(&[
            "add",
            &format!("{}\\shell\\{}\\command", ext_key, VERB_NAME),
            "/ve",
            "/d",
            &open_command,
            "/f",
        ])?;

        // 4. 清理改名前的旧菜单项，它们指向已删除的 md-editer.exe，点了没反应
        for stale in ["使用MDEditor打开", "使用MD编辑器打开"] {
            let _ = reg(&["delete", &format!("{}\\shell\\{}", ext_key, stale), "/f"]);
        }

        // 默认打开方式最终由 FileExts\.md\UserChoice 决定，它优先级最高。
        // Windows 10/11 用哈希校验 + UCPD 驱动保护这个键，任何第三方程序都写不进去，
        // 所以这里不碰它，注册完弹出系统的选择框，让用户自己点一次「始终」
    }

    // 通知外壳刷新关联，否则改了也要重启资源管理器才生效
    unsafe {
        windows::Win32::UI::Shell::SHChangeNotify(
            windows::Win32::UI::Shell::SHCNE_ASSOCCHANGED,
            windows::Win32::UI::Shell::SHCNF_IDLIST | windows::Win32::UI::Shell::SHCNF_FLUSH,
            None,
            None,
        );
    }
    let _ = std::process::Command::new("ie4uinit.exe").arg("-show").status();

    // 弹出系统「你要如何打开这个文件」对话框。它需要一个真实存在的 .md 文件，
    // 放一个空的示例文件到临时目录即可；OpenWith.exe 是独立进程，不用操心 COM 线程模型
    let sample = std::env::temp_dir().join("MDEditor 默认打开方式.md");
    std::fs::write(&sample, "# MDEditor\n").map_err(|e| format!("创建示例文件失败: {}", e))?;
    std::process::Command::new("OpenWith.exe")
        .arg(&sample)
        .spawn()
        .map_err(|e| format!("打开系统选择框失败: {}", e))?;

    Ok(format!(
        "已把 MDEditor 登记为 Markdown 打开方式的候选\n\n\
         程序路径: {}\n\n\
         接下来会弹出系统的「打开方式」对话框：\n\
         选中 MDEditor，并勾选「始终使用此应用打开 .md 文件」即可。\n\n\
         （Windows 10/11 不允许程序自行改写默认打开方式，最后这一步必须由你点击确认）",
        exe_str
    ))
}

// Stub for non-Windows platforms
#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn register_file_associations() -> Result<String, String> {
    Err("此功能仅支持 Windows".into())
}

struct OpenFilePath(Mutex<Option<String>>);

#[tauri::command]
fn get_open_file_path(state: State<OpenFilePath>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenFilePath(Mutex::new(None)));

    #[cfg(desktop)]
    let builder = builder.manage(FileWatcher::default());

    builder
        .setup(|app| {
            // CLI file argument (desktop only — mobile has no CLI args)
            #[cfg(not(target_os = "android"))]
            {
                let args: Vec<String> = std::env::args().collect();
                let file_arg = args.into_iter().skip(1).find(|a| {
                    !a.starts_with('-') && {
                        let p = std::path::Path::new(a);
                        p.exists()
                            && p.extension()
                                .map(|e| {
                                    matches!(
                                        e.to_str(),
                                        Some("md") | Some("markdown") | Some("txt")
                                    )
                                })
                                .unwrap_or(false)
                    }
                });
                if let Some(path) = file_arg {
                    *app.state::<OpenFilePath>().0.lock().unwrap() = Some(path);
                }
            }
            #[cfg(target_os = "android")]
            let _ = app;
            Ok(())
        })
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            get_open_file_path,
            register_file_associations,
            read_text_file,
            write_text_file,
            watch_file,
            unwatch_file,
            list_system_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
