use std::{fs, path::{Path,PathBuf}, io::Read};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{Host,linux_action};
pub fn digest(file:&Path)->Result<String,String>{
    let mut f=fs::File::open(file).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut buffer=[0u8;65536];
    loop{let n=f.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}hash.update(&buffer[..n]);}
    Ok(format!("{:x}",hash.finalize()))
}
fn source(app:&tauri::AppHandle)->Result<PathBuf,String>{
    let file=app.path().config_dir().map_err(|e|e.to_string())?.join("dsh-desktop/config.json");
    let config:Value=serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let distro=config["runtime"]["distro"].as_str().ok_or("Missing old distro")?;
    let home=config["runtime"]["dshHome"].as_str().ok_or("Missing old DSH_HOME")?;
    if distro.is_empty()||!distro.chars().all(|c|c.is_ascii_alphanumeric()||"._-".contains(c))||!home.starts_with("/home/")||home.split('/').any(|p|p=="..")||home.contains(['\\','\0','\n','\r']){return Err("Unsafe legacy location".into());}
    Ok(PathBuf::from(format!("\\\\wsl.localhost\\{}{}\\sessions",distro,home.replace('/',"\\"))))
}
fn inventory(root:&Path)->Result<Vec<Value>,String>{
    if fs::symlink_metadata(root).map_err(|e|e.to_string())?.file_type().is_symlink(){return Err("Legacy root cannot be a symlink".into());}
    fn walk(root:&Path,dir:&Path,rows:&mut Vec<Value>,size:&mut u64,depth:u8)->Result<(),String>{
        if depth>5{return Err("Session directory nesting is too deep".into());}
        for entry in fs::read_dir(dir).map_err(|e|e.to_string())? {
            let path=entry.map_err(|e|e.to_string())?.path();let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
            if meta.file_type().is_symlink(){return Err("Legacy symlinks are not imported".into());}
            if meta.is_dir(){walk(root,&path,rows,size,depth+1)?;}
            else if path.file_name().is_some_and(|n|n=="session.jsonl"||n=="session.jsonl.zstd") {
                *size+=meta.len();if *size>2*1024*1024*1024||rows.len()>=50000{return Err("Migration exceeds 2 GiB / 50000 session limit".into());}
                rows.push(json!({"path":path.strip_prefix(root).unwrap().to_string_lossy().replace('\\',"/"),"bytes":meta.len(),"sha256":digest(&path)?}));
            }
        }Ok(())
    }
    let mut rows=vec![];walk(root,root,&mut rows,&mut 0,0)?;rows.sort_by_key(|r|r["path"].as_str().unwrap().to_string());Ok(rows)
}
pub fn inspect(app:&tauri::AppHandle)->Result<Value,String>{
    let root=source(app)?;let rows=inventory(&root)?;
    Ok(json!({"sessions":rows.len(),"bytes":rows.iter().filter_map(|r|r["bytes"].as_u64()).sum::<u64>(),"source":root.to_string_lossy(),"credentialsIncluded":false,"pluginsIncluded":false}))
}
pub fn import(app:&tauri::AppHandle,host:&Host)->Result<Value,String>{
    let root=source(app)?;let rows=inventory(&root)?;if rows.is_empty(){return Err("No legacy sessions found".into());}
    let id=uuid::Uuid::new_v4().to_string();
    let linux_stage=format!("/home/dsh/.local/share/dsh-next/imports/{id}");
    // Write through WSL's filesystem bridge, not a Windows AppData path: redirected
    // or virtualized AppData is not necessarily visible through /mnt/c.
    let stage=PathBuf::from(format!("\\\\wsl.localhost\\{}{}",crate::DISTRO,linux_stage.replace('/',"\\")));
    host.update(app,json!({"status":"running","message":"复制旧会话并校验；原文件保持不变"}));
    for row in &rows {
        let relative=row["path"].as_str().unwrap();let target=stage.join("sessions").join(relative);
        fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
        fs::copy(root.join(relative),&target).map_err(|e|e.to_string())?;
        if digest(&target)?!=row["sha256"].as_str().unwrap(){return Err("Legacy data changed during copy. Stop old tasks and retry.".into());}
    }
    if inventory(&root)?!=rows{return Err("Legacy data changed during copy. Stop old tasks and retry.".into());}
    fs::write(stage.join("manifest.json"),json!({"format":"dsh-session-copy/v1","files":rows}).to_string()).map_err(|e|e.to_string())?;
    linux_action("migrate",&linux_stage,app,host)
}
