// Exports the third-party app and file-type icons the scenes draw, from this Mac, at 256 px:
// app icons to kit/icons-light/ (`S.app()`), file-type and folder icons to kit/icons/ (`S.ft()`).
// The images belong to their owners, so they are exported locally and kept out of git.
// Usage: swift kit/export-icons.swift
//
// App icons are the bundle's .icns scaled by sips, which is the light artwork whatever the system
// appearance. NSWorkspace.icon(forFile:) follows the appearance and returns dark icons in Dark mode,
// so it is used only for apps marked `system` (the icon as the Dock draws it), with the light icon
// theme forced for this process.
import AppKit
import UniformTypeIdentifiers

UserDefaults.standard.setVolatileDomain(["AppleIconAppearanceTheme": "RegularLight"], forName: UserDefaults.argumentDomain)
NSApplication.shared.appearance = NSAppearance(named: .aqua)
FileManager.default.changeCurrentDirectoryPath(URL(fileURLWithPath: #filePath).deletingLastPathComponent().path)
for dir in ["icons", "icons-light"] { try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true) }

func save(_ image: NSImage, _ file: String, _ px: Int = 256) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSAppearance(named: .aqua)!.performAsCurrentDrawingAppearance {
        image.draw(in: NSRect(x: 0, y: 0, width: px, height: px), from: .zero, operation: .copy, fraction: 1)
    }
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: file))
}

func sips(_ icns: String, _ file: String) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    p.arguments = ["-s", "format", "png", "-Z", "256", icns, "--out", file]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return false }
    p.waitUntilExit()
    return p.terminationStatus == 0
}

func icns(_ app: String) -> String? {
    var name = (Bundle(path: app)?.object(forInfoDictionaryKey: "CFBundleIconFile") as? String) ?? "AppIcon"
    if name.hasSuffix(".icns") { name.removeLast(5) }
    let path = "\(app)/Contents/Resources/\(name).icns"
    return FileManager.default.fileExists(atPath: path) ? path : nil
}

var missing: [String] = []
let apps: [(name: String, path: String, system: Bool)] = [
    ("wechat", "/Applications/WeChat.app", false), ("lark", "/Applications/Lark.app", false),
    ("vscode", "/Applications/Visual Studio Code.app", false), ("chrome", "/Applications/Google Chrome.app", false),
    ("safari", "/System/Cryptexes/App/System/Applications/Safari.app", false), ("obsidian", "/Applications/Obsidian.app", false),
    ("ghostty", "/Applications/Ghostty.app", false), ("chatgpt", "/Applications/ChatGPT.app", false),
    ("keynote", "/Applications/Keynote.app", false), ("telegram", "/Applications/Telegram.app", false),
    ("zed", "/Applications/Zed.app", false),
    ("notes", "/System/Applications/Notes.app", false), ("calendar", "/System/Applications/Calendar.app", false),
    ("music", "/System/Applications/Music.app", false), ("mail", "/System/Applications/Mail.app", false),
    ("finder", "/System/Library/CoreServices/Finder.app", false), ("settings", "/System/Applications/System Settings.app", false),
    ("preview", "/System/Applications/Preview.app", false), ("reminders", "/System/Applications/Reminders.app", false),
    ("photos", "/System/Applications/Photos.app", false), ("fork", "/Applications/Fork.app", false),
    ("pixelmator", "/Applications/Pixelmator Pro Creator Studio.app", false), ("wps", "/Applications/wpsoffice.app", false),
    ("tencentmeeting", "/Applications/TencentMeeting.app", false), ("neteasemusic", "/Applications/NeteaseMusic.app", false),
    // Photoshop 2025's .icns still carries the pre-macOS 26 artwork.
    ("photoshop", "/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app", true),
]
for app in apps {
    guard FileManager.default.fileExists(atPath: app.path) else { missing.append(app.path); continue }
    let file = "icons-light/\(app.name).png"
    if !app.system, let src = icns(app.path), sips(src, file) { continue }
    save(NSWorkspace.shared.icon(forFile: app.path), file)
}
let types: [(String, String)] = [
    ("type-pdf", "com.adobe.pdf"), ("type-xlsx", "org.openxmlformats.spreadsheetml.sheet"),
    ("type-docx", "org.openxmlformats.wordprocessingml.document"), ("type-key", "com.apple.keynote.key"),
    ("type-md", "net.daringfireball.markdown"), ("type-folder", "public.folder"),
    ("type-png", "public.png"), ("type-txt", "public.plain-text"), ("type-pptx", "org.openxmlformats.presentationml.presentation"),
]
for (name, id) in types {
    if let t = UTType(id) { save(NSWorkspace.shared.icon(for: t), "icons/\(name).png") } else { missing.append(id) }
}
let coreTypes = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/"
for (name, file) in [("generic-doc", "GenericDocumentIcon"), ("generic-folder", "GenericFolderIcon"),
                     ("documents-folder", "DocumentsFolderIcon"), ("desktop-folder", "DesktopFolderIcon"),
                     ("downloads-folder", "DownloadsFolder"), ("clipping-text", "ClippingText"),
                     ("generic-url", "GenericURLIcon")] {
    if let img = NSImage(contentsOfFile: coreTypes + file + ".icns") { save(img, "icons/\(name).png") } else { missing.append(file) }
}
print(missing.isEmpty ? "exported all icons" : "missing: \(missing.joined(separator: ", "))")
