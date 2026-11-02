use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Register {
        pair: String,
        path: String,
        name: String,
        icon: String,
    },
    Unregister {
        pair: Option<String>,
    },
    Status {
        pair: String,
        path: String,
        json: String,
    },
    List,
}

#[derive(Debug, Deserialize)]
struct StatusList {
    in_sync: Vec<String>,
    not_in_sync: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ResultJson {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    roots: Option<Vec<RootJson>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    errors: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct RootJson {
    id: String,
    path: String,
    display_name: String,
}

fn parse_args(args: &[String]) -> Result<Command, String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Err("missing command".into());
    };
    let value = |key: &str| -> Result<String, String> {
        args.windows(2)
            .find(|pair| pair[0] == key)
            .map(|pair| pair[1].clone())
            .ok_or_else(|| format!("missing {key}"))
    };
    match command {
        "register" => Ok(Command::Register {
            pair: value("--pair")?,
            path: value("--path")?,
            name: value("--name")?,
            icon: value("--icon")?,
        }),
        "unregister" if args.iter().any(|arg| arg == "--all") => {
            Ok(Command::Unregister { pair: None })
        }
        "unregister" => Ok(Command::Unregister {
            pair: Some(value("--pair")?),
        }),
        "status" => Ok(Command::Status {
            pair: value("--pair")?,
            path: value("--path")?,
            json: value("--json")?,
        }),
        "list" => Ok(Command::List),
        _ => Err(format!("unknown command: {command}")),
    }
}

fn parse_status(json: &str) -> Result<StatusList, String> {
    let list: StatusList = serde_json::from_str(json.trim_start_matches('\u{feff}'))
        .map_err(|error| error.to_string())?;
    for path in list.in_sync.iter().chain(&list.not_in_sync) {
        let path = std::path::Path::new(path);
        if path.is_absolute()
            || path.to_string_lossy().contains(':')
            || path.components().any(|part| {
                matches!(
                    part,
                    std::path::Component::ParentDir
                        | std::path::Component::RootDir
                        | std::path::Component::Prefix(_)
                )
            })
        {
            return Err("status paths must be relative and stay inside the sync root".into());
        }
    }
    Ok(list)
}

#[cfg(windows)]
mod cloud_files {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::Storage::Provider::{
        StorageProviderHardlinkPolicy, StorageProviderHydrationPolicy,
        StorageProviderHydrationPolicyModifier, StorageProviderInSyncPolicy,
        StorageProviderPopulationPolicy, StorageProviderSyncRootInfo,
        StorageProviderSyncRootManager,
    };
    use windows::Storage::StorageFolder;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows::Win32::Storage::CloudFilters::{
        CF_CONVERT_FLAG_MARK_IN_SYNC, CF_IN_SYNC_STATE_IN_SYNC, CF_IN_SYNC_STATE_NOT_IN_SYNC,
        CfConvertToPlaceholder, CfSetInSyncState,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_WRITE_DATA, FILE_WRITE_EA, OPEN_EXISTING,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
    use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};

    struct RoApartment;
    impl RoApartment {
        fn init() -> windows::core::Result<Self> {
            unsafe {
                RoInitialize(RO_INIT_MULTITHREADED)?;
            }
            Ok(Self)
        }
    }
    impl Drop for RoApartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn winpath(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    fn current_sid() -> windows::core::Result<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
            let _token = Handle(token);
            let mut needed = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
            if needed < std::mem::size_of::<TOKEN_USER>() as u32 {
                return Err(windows::core::Error::from_thread());
            }
            let mut buffer = vec![0u8; needed as usize];
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast::<c_void>()),
                needed,
                &mut needed,
            )?;
            let user = &*(buffer.as_ptr().cast::<TOKEN_USER>());
            let mut text = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut text)?;
            let value = PCWSTR(text.0).to_string()?;
            let _ = LocalFree(Some(HLOCAL(text.0.cast())));
            Ok(value)
        }
    }

    fn root_id(pair: &str) -> windows::core::Result<String> {
        Ok(format!("Hourglass!{}!{pair}", current_sid()?))
    }

    fn open_item(path: &Path, is_dir: bool) -> windows::core::Result<Handle> {
        let wide = winpath(path);
        let mut flags = Default::default();
        if is_dir {
            flags |= FILE_FLAG_BACKUP_SEMANTICS;
        }
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_WRITE_DATA.0 | FILE_WRITE_EA.0 | FILE_READ_ATTRIBUTES.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                flags,
                None,
            )?
        };
        Ok(Handle(handle))
    }

    fn set_item(path: &Path, in_sync: bool) -> windows::core::Result<bool> {
        let meta =
            std::fs::symlink_metadata(path).map_err(|_| windows::core::Error::from_thread())?;
        if meta.file_type().is_symlink() {
            return Ok(false);
        }
        let mut handle = open_item(path, meta.is_dir())?;
        let state = if in_sync {
            CF_IN_SYNC_STATE_IN_SYNC
        } else {
            CF_IN_SYNC_STATE_NOT_IN_SYNC
        };
        let set_state =
            |handle: HANDLE| unsafe { CfSetInSyncState(handle, state, Default::default(), None) };
        if let Err(error) = set_state(handle.0) {
            // Ordinary files return ERROR_CLOUD_FILE_NOT_UNDER_SYNC_ROOT here.
            // Existing placeholders were updated successfully above.
            if error.code().0 as u32 != 0x8007_0178 {
                return Err(error);
            }
            let flags = if in_sync {
                CF_CONVERT_FLAG_MARK_IN_SYNC
            } else {
                Default::default()
            };
            unsafe { CfConvertToPlaceholder(handle.0, None, 0, flags, None, None) }.map_err(
                |error| {
                    windows::core::Error::new(
                        error.code(),
                        format!("CfConvertToPlaceholder: {error}"),
                    )
                },
            )?;
            drop(handle);
            handle = open_item(path, meta.is_dir())?;
            set_state(handle.0).map_err(|error| {
                windows::core::Error::new(
                    error.code(),
                    format!("CfSetInSyncState after conversion: {error}"),
                )
            })?;
        }
        Ok(true)
    }

    fn register(
        pair: &str,
        path: &str,
        name: &str,
        icon: &str,
    ) -> windows::core::Result<ResultJson> {
        let _apartment = RoApartment::init()?;
        let root_path =
            std::fs::canonicalize(path).map_err(|_| windows::core::Error::from_thread())?;
        let full_path = root_path.to_string_lossy();
        let winrt_path = full_path.strip_prefix("\\\\?\\").unwrap_or(&full_path);
        let operation = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(winrt_path))?;
        while operation.Status()?.0 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let folder = operation.GetResults()?;
        let id = root_id(pair)?;
        if let Ok(existing) =
            StorageProviderSyncRootManager::GetSyncRootInformationForId(&HSTRING::from(id.as_str()))
        {
            let existing_folder: StorageFolder = existing.Path()?.cast()?;
            let existing_path = existing_folder.Path()?.to_string_lossy();
            if std::fs::canonicalize(&existing_path).ok().as_ref() == Some(&root_path) {
                return Ok(ResultJson {
                    ok: true,
                    id: Some(id),
                    path: Some(root_path.to_string_lossy().into_owned()),
                    roots: None,
                    updated: None,
                    errors: None,
                });
            }
            StorageProviderSyncRootManager::Unregister(&HSTRING::from(id.as_str()))?;
        }
        let info = StorageProviderSyncRootInfo::new()?;
        info.SetId(&HSTRING::from(id.as_str()))?;
        info.SetPath(&folder)?;
        info.SetDisplayNameResource(&HSTRING::from(format!("Hourglass – {name}")))?;
        info.SetIconResource(&HSTRING::from(format!("{icon},0")))?;
        info.SetHydrationPolicy(StorageProviderHydrationPolicy::AlwaysFull)?;
        info.SetHydrationPolicyModifier(StorageProviderHydrationPolicyModifier::None)?;
        info.SetPopulationPolicy(StorageProviderPopulationPolicy::AlwaysFull)?;
        info.SetInSyncPolicy(
            StorageProviderInSyncPolicy::FileLastWriteTime
                | StorageProviderInSyncPolicy::DirectoryLastWriteTime,
        )?;
        info.SetHardlinkPolicy(StorageProviderHardlinkPolicy::None)?;
        info.SetVersion(&HSTRING::from("1.0"))?;
        StorageProviderSyncRootManager::Register(&info)?;
        Ok(ResultJson {
            ok: true,
            id: Some(id),
            path: Some(root_path.to_string_lossy().into_owned()),
            roots: None,
            updated: None,
            errors: None,
        })
    }

    fn list_roots() -> windows::core::Result<Vec<RootJson>> {
        let _apartment = RoApartment::init()?;
        let view = StorageProviderSyncRootManager::GetCurrentSyncRoots()?;
        let mut roots = Vec::new();
        for index in 0..view.Size()? {
            let info = view.GetAt(index)?;
            let folder: StorageFolder = info.Path()?.cast()?;
            let path = folder.Path()?.to_string_lossy();
            roots.push(RootJson {
                id: info.Id()?.to_string(),
                path,
                display_name: info.DisplayNameResource()?.to_string(),
            });
        }
        Ok(roots)
    }

    fn unregister(pair: Option<&str>) -> windows::core::Result<ResultJson> {
        let _apartment = RoApartment::init()?;
        let sid = current_sid()?;
        let prefix = format!("Hourglass!{sid}!");
        let selected = if let Some(pair) = pair {
            vec![root_id(pair)?]
        } else {
            let roots = StorageProviderSyncRootManager::GetCurrentSyncRoots()?;
            let mut values = Vec::new();
            for index in 0..roots.Size()? {
                let id = roots.GetAt(index)?.Id()?.to_string();
                if id.starts_with(&prefix) {
                    values.push(id);
                }
            }
            // The manager enumeration can omit roots while Explorer is refreshing.
            // The installed app's pair manifest is the durable source for cleanup.
            let data = std::env::var_os("HOURGLASS_DATA")
                .map(std::path::PathBuf::from)
                .or_else(|| {
                    std::env::var_os("LOCALAPPDATA")
                        .map(|base| std::path::PathBuf::from(base).join("Hourglass"))
                });
            if let Some(data) = data {
                if let Ok(body) = std::fs::read_to_string(data.join("syncfolders.json")) {
                    if let Ok(pairs) = serde_json::from_str::<Vec<serde_json::Value>>(&body) {
                        for pair in pairs {
                            if let Some(id) = pair.get("id").and_then(serde_json::Value::as_str) {
                                let id = format!("{prefix}{id}");
                                if !values.contains(&id) {
                                    values.push(id);
                                }
                            }
                        }
                    }
                }
            }
            values
        };
        let mut errors = Vec::new();
        for id in &selected {
            if let Err(error) =
                StorageProviderSyncRootManager::Unregister(&HSTRING::from(id.as_str()))
            {
                errors.push(format!("{id}: {error}"));
            }
        }
        Ok(ResultJson {
            ok: errors.is_empty(),
            id: None,
            path: None,
            roots: None,
            updated: None,
            errors: (!errors.is_empty()).then_some(errors),
        })
    }

    fn status(pair: &str, path: &str, json_path: &str) -> Result<ResultJson, String> {
        let _apartment = RoApartment::init().map_err(|error| error.to_string())?;
        let root = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let body = std::fs::read_to_string(json_path).map_err(|error| error.to_string())?;
        let list = parse_status(&body)?;
        let id = root_id(pair).map_err(|error| error.to_string())?;
        let mut items = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (value, in_sync) in list
            .in_sync
            .iter()
            .map(|path| (path, true))
            .chain(list.not_in_sync.iter().map(|path| (path, false)))
        {
            if !seen.insert(value.to_lowercase()) {
                return Err(format!("duplicate status path: {value}"));
            }
            let target = root.join(value);
            let target =
                std::fs::canonicalize(&target).map_err(|error| format!("{value}: {error}"))?;
            if !target.starts_with(&root) {
                return Err(format!("status path escapes sync root: {value}"));
            }
            items.push((target, in_sync));
        }
        items.sort_by_key(|(path, _)| path.components().count());
        let mut converted = 0usize;
        let mut errors = Vec::new();
        for (target, in_sync) in items {
            match set_item(&target, in_sync) {
                Ok(true) => converted += 1,
                Ok(false) => errors.push(format!(
                    "{}: skipped symbolic link or another provider's reparse point",
                    target.display()
                )),
                Err(error) => errors.push(format!("{}: {error}", target.display())),
            }
        }
        Ok(ResultJson {
            ok: errors.is_empty(),
            id: Some(id),
            path: Some(root.to_string_lossy().into_owned()),
            roots: None,
            updated: Some(converted),
            errors: (!errors.is_empty()).then_some(errors),
        })
    }

    pub fn execute(command: Command) -> Result<ResultJson, String> {
        match command {
            Command::Register {
                pair,
                path,
                name,
                icon,
            } => register(&pair, &path, &name, &icon).map_err(|error| error.to_string()),
            Command::Unregister { pair } => {
                unregister(pair.as_deref()).map_err(|error| error.to_string())
            }
            Command::Status { pair, path, json } => status(&pair, &path, &json),
            Command::List => list_roots()
                .map(|roots| ResultJson {
                    ok: true,
                    id: None,
                    path: None,
                    roots: Some(roots),
                    updated: None,
                    errors: None,
                })
                .map_err(|error| error.to_string()),
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match parse_args(&args) {
        Ok(command) => {
            #[cfg(windows)]
            {
                cloud_files::execute(command).map_err(|error| (1, error))
            }
            #[cfg(not(windows))]
            {
                let _ = command;
                Err((1, "Cloud Files is only available on Windows".into()))
            }
        }
        Err(error) => Err((2, error)),
    };
    match result {
        Ok(output) => {
            println!(
                "{}",
                serde_json::to_string(&output).unwrap_or_else(|_| "{\"ok\":false}".into())
            );
            if !output.ok {
                std::process::exit(1);
            }
        }
        Err((code, error)) => {
            eprintln!("{}", serde_json::json!({ "ok": false, "error": error }));
            std::process::exit(code);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    #[test]
    fn parses_register_and_unregister_arguments() {
        assert_eq!(
            parse_args(&args(&[
                "register",
                "--pair",
                "p1",
                "--path",
                "C:\\sync",
                "--name",
                "Docs",
                "--icon",
                "hourglass.ico"
            ]))
            .unwrap(),
            Command::Register {
                pair: "p1".into(),
                path: "C:\\sync".into(),
                name: "Docs".into(),
                icon: "hourglass.ico".into()
            }
        );
        assert_eq!(
            parse_args(&args(&["unregister", "--pair", "p1"])).unwrap(),
            Command::Unregister {
                pair: Some("p1".into())
            }
        );
        assert_eq!(
            parse_args(&args(&["unregister", "--all"])).unwrap(),
            Command::Unregister { pair: None }
        );
        assert!(parse_args(&args(&["register", "--pair", "p1"])).is_err());
    }

    #[test]
    fn parses_status_json_and_rejects_paths_outside_root() {
        let list =
            parse_status(r#"{"in_sync":["file.txt","docs"],"not_in_sync":["new.txt"]}"#).unwrap();
        assert_eq!(list.in_sync, ["file.txt", "docs"]);
        assert_eq!(list.not_in_sync, ["new.txt"]);
        assert!(parse_status(r#"{"in_sync":["../outside"],"not_in_sync":[]}"#).is_err());
        assert!(parse_status("not json").is_err());
    }
}
