use base64::Engine;
fn main(){
    let file=std::env::args().nth(1).expect("installer path");
    let public=base64::engine::general_purpose::STANDARD.decode(include_str!("../update.pub").trim()).unwrap();
    let signature=base64::engine::general_purpose::STANDARD.decode(std::fs::read_to_string(format!("{file}.sig")).unwrap().trim()).unwrap();
    let key=minisign_verify::PublicKey::decode(std::str::from_utf8(&public).unwrap()).unwrap();
    let signature=minisign_verify::Signature::decode(std::str::from_utf8(&signature).unwrap()).unwrap();
    let mut bytes=std::fs::read(file).unwrap();
    key.verify(&bytes,&signature,true).expect("valid signature");
    bytes[0]^=1;assert!(key.verify(&bytes,&signature,true).is_err());
    println!("SIGNED_ARTIFACT_ACCEPTED_TAMPERING_REJECTED");
}
