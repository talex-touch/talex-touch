//! Chrome Native Messaging relay. No Chrome profile/filesystem data is read.
//! stdout is reserved exclusively for bounded native frames.
use std::env;
use std::fs::File;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, SocketAddrV4, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const MAX_FRAME_BYTES: usize = 768 * 1024;
const EXTENSION_ID: &str = "dalmacfpdfmbedbaamfinhaikanpafcl";

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn caller_origin() -> io::Result<String> {
    let origin = env::args().nth(1).ok_or_else(|| invalid("missing extension origin"))?;
    let expected = format!("chrome-extension://{}/", EXTENSION_ID);
    if origin != expected && origin != expected.trim_end_matches('/') {
        return Err(invalid("unapproved extension origin"));
    }
    Ok(expected)
}

fn endpoint() -> io::Result<(SocketAddr, String)> {
    let executable = env::current_exe()?;
    let descriptor = executable.parent().ok_or_else(|| invalid("missing executable directory"))?.join("endpoint");
    let file = File::open(descriptor)?;
    let length = file.metadata()?.len();
    if length == 0 || length > 512 { return Err(invalid("endpoint descriptor length out of bounds")); }
    let mut bytes = Vec::with_capacity(length as usize);
    file.take(512).read_to_end(&mut bytes)?;
    if bytes.len() as u64 != length { return Err(invalid("endpoint descriptor changed during read")); }
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid("endpoint is not ASCII"))?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let mut lines = text.split('\n');
    let address = lines.next().filter(|line| !line.is_empty()).ok_or_else(|| invalid("missing endpoint address"))?;
    let server_key = lines.next().filter(|line| !line.is_empty()).ok_or_else(|| invalid("missing server public key"))?;
    if lines.next().is_some() { return Err(invalid("endpoint must contain exactly two lines")); }
    let port_text = address.strip_prefix("127.0.0.1:").ok_or_else(|| invalid("endpoint is not loopback IPv4"))?;
    if port_text.is_empty() || !port_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid("invalid endpoint port"));
    }
    let port = port_text.parse::<u16>().map_err(|_| invalid("invalid endpoint port"))?;
    if port == 0 { return Err(invalid("zero endpoint port")); }
    let payload = server_key.trim_end_matches('=');
    if server_key.len() < 64 || server_key.len() > 480 || server_key.len() % 4 != 0 || server_key.len() - payload.len() > 2
        || !payload.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/') {
        return Err(invalid("server public key is not bounded base64"));
    }
    Ok((SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)), server_key.to_owned()))
}

fn read_frame(reader: &mut impl Read, buffer: &mut Vec<u8>) -> io::Result<bool> {
    let mut header = [0u8; 4];
    loop {
        match reader.read(&mut header[..1]) {
            Ok(0) => return Ok(false),
            Ok(_) => break,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    reader.read_exact(&mut header[1..])?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES { return Err(invalid("frame length out of bounds")); }
    buffer.resize(length, 0);
    reader.read_exact(buffer)?;
    std::str::from_utf8(buffer).map_err(|_| invalid("frame is not UTF-8"))?;
    Ok(true)
}

fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES { return Err(invalid("frame length out of bounds")); }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()
}

fn relay(mut reader: impl Read, mut writer: impl Write) -> io::Result<()> {
    let mut buffer = Vec::new();
    while read_frame(&mut reader, &mut buffer)? {
        write_frame(&mut writer, &buffer)?;
    }
    Ok(())
}

fn run() -> io::Result<()> {
    let origin = caller_origin()?;
    let (address, server_key) = endpoint()?;
    {
        // Release this lock before starting the stdout relay worker.
        let stdout = io::stdout();
        let mut writer = stdout.lock();
        write_frame(&mut writer, format!("{{\"type\":\"native-host-info\",\"serverPublicKey\":\"{}\"}}", server_key).as_bytes())?;
    }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
    stream.set_nodelay(true)?;
    // Origin consists solely of a validated fixed ASCII identity: JSON escaping is unnecessary.
    write_frame(&mut stream, format!("{{\"type\":\"origin\",\"origin\":\"{}\"}}", origin).as_bytes())?;
    let inbound = stream.try_clone()?;
    let outbound = stream.try_clone()?;
    let (sender, receiver) = mpsc::channel();
    let browser_sender = sender.clone();
    thread::spawn(move || {
        let result = relay(io::stdin().lock(), outbound);
        let _ = browser_sender.send(result);
    });
    thread::spawn(move || {
        let result = relay(inbound, io::stdout().lock());
        let _ = sender.send(result);
    });
    // Either side closing ends the entire host, including a blocked stdin reader.
    let result = receiver.recv().map_err(|_| invalid("relay workers disconnected"))?;
    let _ = stream.shutdown(Shutdown::Both);
    result
}

fn main() {
    if let Err(error) = run() {
        eprintln!("tuff-browser-bridge: {}", error);
        std::process::exit(1);
    }
}
