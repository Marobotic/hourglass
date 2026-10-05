import SwiftUI
import UIKit

// The toolbar writes the same Markdown as the desktop's: **bold**, *italic*,
// <u>underline</u>, ~~strike~~, and "## ", "- ", "1. " in front of lines.
// Again on the same selection takes it off. Offsets are UTF-16, as NSString.
enum NoteFormat {
    static func wrap(_ text: String, _ a: Int, _ b: Int, _ pre: String, _ post: String) -> (String, Int, Int) {
        let ns = text as NSString
        let sel = ns.substring(with: NSRange(location: a, length: b - a))
        let p = (pre as NSString).length, q = (post as NSString).length
        if (sel as NSString).length >= p + q && sel.hasPrefix(pre) && sel.hasSuffix(post) {
            let inner = (sel as NSString).substring(with: NSRange(location: p, length: (sel as NSString).length - p - q))
            return (ns.replacingCharacters(in: NSRange(location: a, length: b - a), with: inner), a, a + (inner as NSString).length)
        }
        let out = ns.replacingCharacters(in: NSRange(location: a, length: b - a), with: pre + sel + post)
        return sel.isEmpty ? (out, a + p, a + p) : (out, a, a + p + (sel as NSString).length + q)
    }

    static func lines(_ text: String, _ a: Int, _ b: Int, _ kind: String) -> (String, Int, Int) {
        let ns = text as NSString
        var r = ns.lineRange(for: NSRange(location: a, length: max(0, b - a - (b > a ? 1 : 0))))
        if r.length > 0 && ns.substring(with: NSRange(location: r.location + r.length - 1, length: 1)) == "\n" { r.length -= 1 }
        let rows = ns.substring(with: r).components(separatedBy: "\n")
        let re = kind == "ul" ? "^[-*] " : kind == "ol" ? "^\\d+\\. " : "^#{1,6} "
        let on = rows.allSatisfy { $0.range(of: re, options: .regularExpression) != nil }
        let out = rows.enumerated().map { i, row -> String in
            if on { return row.replacingOccurrences(of: re, with: "", options: .regularExpression) }
            let bare = row.replacingOccurrences(of: "^([-*] |\\d+\\. |#{1,6} )", with: "", options: .regularExpression)
            return (kind == "ul" ? "- " : kind == "ol" ? "\(i + 1). " : "## ") + bare
        }.joined(separator: "\n")
        let end = r.location + (out as NSString).length
        return (ns.replacingCharacters(in: r, with: out), end, end)
    }
}

// **bold**, *italic*, <u>underline</u>, ~~strike~~, [links] as their text.
func inlineMd(_ s: String) -> AttributedString {
    let re = try! NSRegularExpression(pattern: #"\*\*(.+?)\*\*|<u>(.+?)</u>|~~(.+?)~~|\*(.+?)\*|\[([^\]]+)\]\([^)]+\)"#)
    let ns = s as NSString
    var out = AttributedString()
    var i = 0
    for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
        out += AttributedString(ns.substring(with: NSRange(location: i, length: m.range.location - i)))
        func g(_ k: Int) -> String? { m.range(at: k).location == NSNotFound ? nil : ns.substring(with: m.range(at: k)) }
        if let t = g(1) { var a = inlineMd(t); a.inlinePresentationIntent = .stronglyEmphasized; out += a }
        else if let t = g(2) { var a = inlineMd(t); a.underlineStyle = .single; out += a }
        else if let t = g(3) { var a = inlineMd(t); a.strikethroughStyle = .single; out += a }
        else if let t = g(4) { var a = inlineMd(t); a.inlinePresentationIntent = .emphasized; out += a }
        else if let t = g(5) { var a = AttributedString(t); a.foregroundColor = H.accent; out += a }
        i = m.range.location + m.range.length
    }
    out += AttributedString(ns.substring(from: i))
    return out
}

// A note as it reads: headings, lists, inline styles, and its pictures and
// files. An attachment is a line of its own: ![name](hgfile:<id>) a picture,
// [name](hgfile:<id>) a file - the form the desktop writes.
struct NoteBodyView: View {
    @EnvironmentObject var store: Store
    let text: String
    let open: (DriveFile) -> Void

    private static let img = try! NSRegularExpression(pattern: #"^\s*!\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$"#)
    private static let file = try! NSRegularExpression(pattern: #"^\s*\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$"#)

    private func match(_ re: NSRegularExpression, _ line: String) -> (String, String)? {
        let ns = line as NSString
        guard let m = re.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (ns.substring(with: m.range(at: 1)), ns.substring(with: m.range(at: 2)))
    }

    private enum Block { case picture(String, String), file(String, String), gap, heading(Int, String), bullet(String), numbered(String, String), text(String) }

    private func block(_ line: String) -> Block {
        if let m = match(Self.img, line) { return .picture(m.0, m.1) }
        if let m = match(Self.file, line) { return .file(m.0.replacingOccurrences(of: "📎", with: "").trimmingCharacters(in: .whitespaces), m.1) }
        if line.trimmingCharacters(in: .whitespaces).isEmpty { return .gap }
        if let r = line.range(of: "^#{1,6} ", options: .regularExpression) { return .heading(line[r].count - 1, String(line[r.upperBound...])) }
        if let r = line.range(of: #"^\s*[-*] "#, options: .regularExpression) { return .bullet(String(line[r.upperBound...])) }
        if let r = line.range(of: #"^\s*\d+\. "#, options: .regularExpression) { return .numbered(String(line[r]).trimmingCharacters(in: .whitespaces), String(line[r.upperBound...])) }
        return .text(line)
    }

    var body: some View {
        let blocks = text.components(separatedBy: "\n").map(block)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                switch b {
                case .picture(let name, let id): NotePicture(id: id, name: name, open: open)
                case .file(let name, let id): FileChip(name: name) { if let f = store.file(id) { open(f) } }
                case .gap: Spacer().frame(height: 4)
                case .heading(let level, let t): Text(inlineMd(t)).font(H.mono(level == 1 ? 24 : level == 2 ? 20 : 17, bold: true)).foregroundStyle(H.fg)
                case .bullet(let t): HStack(alignment: .top, spacing: 0) { T("•  ", 15, H.muted); Text(inlineMd(t)).font(H.mono(15)).foregroundStyle(H.fg) }
                case .numbered(let n, let t): HStack(alignment: .top, spacing: 0) { T(n + " ", 15, H.muted); Text(inlineMd(t)).font(H.mono(15)).foregroundStyle(H.fg) }
                case .text(let t): Text(inlineMd(t)).font(H.mono(15)).foregroundStyle(H.fg)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NotePicture: View {
    @EnvironmentObject var store: Store
    let id: String
    let name: String
    let open: (DriveFile) -> Void
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 420)
                    .onTapGesture { if let f = store.file(id) { open(f) } }
            } else if failed {
                FileChip(name: name) { if let f = store.file(id) { open(f) } }
            } else {
                ZStack { Rectangle().fill(H.surface); T("Loading picture…", 12, H.faint) }.frame(height: 120)
            }
        }
        .task(id: id) {
            guard let f = store.file(id), let url = try? await store.download(f), let img = UIImage(contentsOfFile: url.path) else { failed = true; return }
            image = img
        }
    }
}

private struct FileChip: View {
    let name: String
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            HStack(spacing: 8) { Image(systemName: "paperclip").foregroundStyle(H.muted); T(name, 14, lines: 1) }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
