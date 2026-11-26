import SwiftUI
import UIKit

// Note Markdown rules shared with the desktop (Util.qml) and Android (Md).
// Offsets are UTF-16, as NSString.
enum Md {
    static let task = try! NSRegularExpression(pattern: #"^(\s*)[-*] \[([ xX])\] ?(.*)$"#)
    static let list = try! NSRegularExpression(pattern: #"^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)\. )"#)
    static let ol = try! NSRegularExpression(pattern: #"^(\s*)(\d+)\. "#)

    /// The match's groups as strings ("" for a group that did not take part), or nil.
    static func groups(_ re: NSRegularExpression, _ s: String) -> [String]? {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
    }

    /// Numbered lists count 1, 2, 3 again: each run of "N. " lines at one indent
    /// is renumbered from its first number. Deeper lines and blank lines keep the
    /// run going; any other line ends it.
    static func renumber(_ text: String) -> String {
        var lines = text.components(separatedBy: "\n")
        var runs: [Int: Int] = [:] // indent -> next number
        var inFence = false // code blocks keep their lines as written
        for i in lines.indices {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { inFence.toggle(); runs = [:]; continue }
            if inFence { continue }
            if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
            let indent = line.prefix(while: { $0 == " " || $0 == "\t" }).count
            for k in runs.keys where k > indent { runs[k] = nil }
            guard let g = groups(ol, line) else { runs[indent] = nil; continue }
            let n = runs[indent] ?? Int(g[2]) ?? 1
            runs[indent] = n + 1
            lines[i] = g[1] + "\(n). " + (line as NSString).substring(from: (g[0] as NSString).length)
        }
        return lines.joined(separator: "\n")
    }

    /// Flips the to-do on line `index`; the text unchanged if that line is not one.
    static func toggleTask(_ text: String, _ index: Int) -> String {
        var lines = text.components(separatedBy: "\n")
        guard index < lines.count, let g = groups(task, lines[index]) else { return text }
        if let r = lines[index].range(of: #"\[[ xX]\]"#, options: .regularExpression) {
            lines[index].replaceSubrange(r, with: g[2] == " " ? "[x]" : "[ ]")
        }
        return lines.joined(separator: "\n")
    }

    /// After Enter on a list line: the next line starts the next item (a new to-do
    /// unticked, a number counted on). Enter on an empty item ends the list. nil
    /// when the Enter was not on a list line. `cursor` is where the newline went.
    static func continueList(_ before: String, _ cursor: Int) -> (String, Int)? {
        let ns = before as NSString
        let newline = ns.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: cursor)).location
        let lineStart = newline == NSNotFound ? 0 : newline + 1
        let line = ns.substring(with: NSRange(location: lineStart, length: cursor - lineStart))
        guard let g = groups(list, line) else { return nil }
        let rest = ns.substring(from: cursor)
        if line.trimmingCharacters(in: .whitespaces) == g[2].trimmingCharacters(in: .whitespaces) {
            return (ns.substring(to: lineStart) + rest, lineStart)
        }
        let next = g[2].contains("[") ? g[2].replacingOccurrences(of: #"\[[xX]\]"#, with: "[ ]", options: .regularExpression)
            : !g[3].isEmpty ? "\((Int(g[3]) ?? 0) + 1). " : g[2]
        let insert = "\n" + g[1] + next
        let text = ns.substring(to: cursor) + insert + rest
        let pos = cursor + (insert as NSString).length
        return g[3].isEmpty ? (text, pos) : renumberKeeping(text, pos)
    }

    /// Renumbers, keeping the cursor at the same place in its line.
    static func renumberKeeping(_ text: String, _ cursor: Int) -> (String, Int) {
        let out = renumber(text)
        if out == text { return (text, cursor) }
        let ns = text as NSString
        let line = ns.substring(to: cursor).components(separatedBy: "\n").count - 1
        let lineStart = ns.substring(to: cursor).components(separatedBy: "\n").dropLast().reduce(0) { $0 + ($1 as NSString).length + 1 }
        let col = cursor - lineStart
        let before = text.components(separatedBy: "\n")[line], afterLines = out.components(separatedBy: "\n"), after = afterLines[line]
        let shift = ((groups(ol, after)?[0] ?? "") as NSString).length - ((groups(ol, before)?[0] ?? "") as NSString).length
        let start = afterLines.prefix(line).reduce(0) { $0 + ($1 as NSString).length + 1 }
        return (out, start + min(max(0, col + shift), (after as NSString).length))
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
    /// The line of the note a ticked box is on. Without it, boxes only show.
    var onToggle: ((Int) -> Void)? = nil

    private static let img = try! NSRegularExpression(pattern: #"^\s*!\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$"#)
    private static let file = try! NSRegularExpression(pattern: #"^\s*\[([^\]]*)\]\(hgfile:([0-9a-f-]{36})\)\s*$"#)

    private func match(_ re: NSRegularExpression, _ line: String) -> (String, String)? {
        let ns = line as NSString
        guard let m = re.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (ns.substring(with: m.range(at: 1)), ns.substring(with: m.range(at: 2)))
    }

    private enum Block { case picture(String, String), file(String, String), gap, heading(Int, String), bullet(Int, String), numbered(Int, String, String), task(Int, Bool, String), text(String), code(String), table([[String]]) }

    private static let divider = try! NSRegularExpression(pattern: #"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$"#)

    private static func isDivider(_ line: String) -> Bool {
        guard line.contains("|") else { return false }
        return Md.groups(divider, line) != nil
    }

    private static func cells(_ line: String) -> [String] {
        var t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") { t.removeLast() }
        return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// Lines into blocks, each with the line it starts on. A fenced code block and
    /// a table take several lines; an unclosed fence (still streaming) runs to the end.
    private func parse(_ lines: [String]) -> [(Int, Block)] {
        var out: [(Int, Block)] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                var body: [String] = []
                var j = i + 1
                while j < lines.count && !lines[j].trimmingCharacters(in: .whitespaces).hasPrefix("```") { body.append(lines[j]); j += 1 }
                out.append((i, Block.code(body.joined(separator: "\n"))))
                i = j + 1
                continue
            }
            if line.contains("|"), i + 1 < lines.count, Self.isDivider(lines[i + 1]) {
                var rows: [[String]] = [Self.cells(line)]
                var j = i + 2
                while j < lines.count && lines[j].contains("|") && !lines[j].trimmingCharacters(in: .whitespaces).isEmpty { rows.append(Self.cells(lines[j])); j += 1 }
                out.append((i, Block.table(rows)))
                i = j
                continue
            }
            out.append((i, block(line)))
            i += 1
        }
        return out
    }

    private func block(_ line: String) -> Block {
        if let m = match(Self.img, line) { return .picture(m.0, m.1) }
        if let m = match(Self.file, line) { return .file(m.0.replacingOccurrences(of: "📎", with: "").trimmingCharacters(in: .whitespaces), m.1) }
        if line.trimmingCharacters(in: .whitespaces).isEmpty { return .gap }
        if let r = line.range(of: "^#{1,6} ", options: .regularExpression) { return .heading(line[r].count - 1, String(line[r.upperBound...])) }
        let indent = line.prefix(while: { $0 == " " || $0 == "\t" }).count
        if let g = Md.groups(Md.task, line) { return .task(indent, g[2] != " ", g[3]) }
        if let r = line.range(of: #"^\s*[-*] "#, options: .regularExpression) { return .bullet(indent, String(line[r.upperBound...])) }
        if let r = line.range(of: #"^\s*\d+\. "#, options: .regularExpression) { return .numbered(indent, String(line[r]).trimmingCharacters(in: .whitespaces), String(line[r.upperBound...])) }
        return .text(line)
    }

    var body: some View {
        // Renumbering keeps every line where it is, so indexes still match the note.
        let blocks: [(Int, Block)] = parse(Md.renumber(text).components(separatedBy: "\n"))
        VStack(alignment: .leading, spacing: 6) {
            ForEach(blocks.indices, id: \.self) { n in
                let index = blocks[n].0
                switch blocks[n].1 {
                case .code(let c): CodeBlockView(code: c)
                case .table(let rows): TableBlockView(rows: rows)
                case .picture(let name, let id): NotePicture(id: id, name: name, open: open)
                case .file(let name, let id): FileChip(name: name) { if let f = store.file(id) { open(f) } }
                case .gap: Spacer().frame(height: 4)
                case .heading(let level, let t): Text(inlineMd(t)).font(H.ui(level == 1 ? 24 : level == 2 ? 20 : 17, bold: true)).foregroundStyle(H.fg)
                case .bullet(let indent, let t): HStack(alignment: .top, spacing: 0) { T("•  ", 14, H.muted); Text(inlineMd(t)).font(H.ui(14)).foregroundStyle(H.fg) }.padding(.leading, CGFloat(indent * 6))
                case .numbered(let indent, let n, let t): HStack(alignment: .top, spacing: 0) { T(n + " ", 14, H.muted); Text(inlineMd(t)).font(H.ui(14)).foregroundStyle(H.fg) }.padding(.leading, CGFloat(indent * 6))
                case .task(let indent, let done, let t): TaskRow(done: done, text: t, toggle: onToggle.map { f in { f(index) } }).padding(.leading, CGFloat(indent * 6))
                case .text(let t): Text(inlineMd(t)).font(H.ui(14)).foregroundStyle(H.fg)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// A fenced code block: monospace, scrolls sideways, with a copy button.
struct CodeBlockView: View {
    let code: String
    @State private var copied = false

    private func copy() {
        UIPasteboard.general.string = code
        copied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            copied = false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                Button(action: copy) {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 11))
                        T(copied ? "Copied" : "Copy", 12, copied ? H.teal : H.muted)
                    }
                    .foregroundStyle(copied ? H.teal : H.muted)
                    .padding(.horizontal, 8).padding(.vertical, 5)
                }
                .buttonStyle(.plain)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code).font(H.ui(13)).foregroundStyle(H.fg)
                    .fixedSize(horizontal: true, vertical: true)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10).padding(.bottom, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(H.surface)
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }
}

// A GitHub table: a grid with a header row.
struct TableBlockView: View {
    let rows: [[String]]
    private var columns: Int { rows.map { $0.count }.max() ?? 0 }

    private func cell(_ r: Int, _ c: Int) -> some View {
        let value: String = c < rows[r].count ? rows[r][c] : ""
        let fill: Color = r == 0 ? H.surface2 : Color.clear
        return Text(inlineMd(value)).font(H.ui(13, bold: r == 0)).foregroundStyle(H.fg)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill)
            .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(rows.indices, id: \.self) { r in
                    GridRow {
                        ForEach(0..<columns, id: \.self) { c in cell(r, c) }
                    }
                }
            }
        }
    }
}

// One to-do: the 0.3.4 box (TodoBox, the same as the note editor), then the item; wrapped text hangs under the text,
// never under the box.
private struct TaskRow: View {
    let done: Bool
    let text: String
    let toggle: (() -> Void)?
    @State private var frame = CGRect.zero
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button { if !done && toggle != nil { Motion.shared.burst(in: frame) }; toggle?() } label: {
                TodoBox(done: done, animated: true)
                    .burstAnchor($frame)
                    .padding(.top, 3)
                    .contentShape(Rectangle().inset(by: -12)) // a bigger target than the box
            }
            .buttonStyle(.plain)
            .disabled(toggle == nil)
            Text(inlineMd(text)).font(H.ui(14)).foregroundStyle(done ? H.muted : H.fg).strikethrough(done, color: H.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
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
                .background(H.surface).overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}
