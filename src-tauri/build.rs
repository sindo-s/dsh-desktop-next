fn main() {
    println!("cargo:rerun-if-env-changed=DSH_OFFLINE_MANIFEST");
    if let Ok(file)=std::env::var("DSH_OFFLINE_MANIFEST"){
        println!("cargo:rerun-if-changed={file}");
        let manifest:serde_json::Value=serde_json::from_slice(&std::fs::read(file).expect("offline manifest")).expect("offline JSON");
        for (key,env) in [("rootfsSha256","DSH_ROOTFS_SHA256"),("wslSha256","DSH_WSL_SHA256")] {
            let hash=manifest[key].as_str().expect("hash");assert!(hash.len()==64&&hash.bytes().all(|b|b.is_ascii_hexdigit()));
            println!("cargo:rustc-env={env}={hash}");
        }
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["run_action", "get_job", "open_core","hide_core","choose_directory","desktop_update"]),
    )).expect("tauri build");
}
