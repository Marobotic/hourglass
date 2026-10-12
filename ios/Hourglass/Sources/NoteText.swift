import Foundation

// Hourglass note text: a port of core/noteformat.js (the reference; its test,
// core/test/noteformat.test.js, is the spec; Android's NoteFormat.kt is the
// other port).
//
// A note is Markdown, one line per line, plus <u>underline</u> and
// <span style="font-family: Lora; font-size: 20px">…</span> for what Markdown
// has no syntax for. The editor parses a note into lines of styled runs,
// shows those, and serializes them back.

struct NoteRun: Equatable {
    var text: String
    var b = false, i = false, u = false, s = false, code = false
    var font: String? = nil
    var size: Int? = nil
    var href: String? = nil

    func sameStyle(_ o: NoteRun) -> Bool {
        b == o.b && i == o.i && u == o.u && s == o.s && code == o.code && font == o.font && size == o.size && href == o.href
    }
    func with(_ t: String) -> NoteRun { var r = self; r.text = t; return r }
}

struct NoteLine: Equatable {
    var kind = "p" // p | ul | ol | todo | image | file
    var indent = 0
    var h = 0
    var num = 1
    var checked = false
    var runs: [NoteRun] = []
    var fileId: String? = nil
    var fileUrl: String? = nil
    var fileName = ""
    var text: String { runs.map(\.text).joined() }
}

struct LineKind: Equatable { var kind: String; var indent: Int; var prefix: Int; var num = 0; var checked = false }

enum NoteFormat {
    static let fonts = ["Inter", "Lora", "JetBrains Mono", "Caveat", "Playfair Display"]
    static let sizes = [12, 14, 15, 16, 18, 20, 24, 28, 32, 40]
    static let defaultSize = 15
    static let headingSizes = [0, 26, 21, 18]
    static let bullet = "•", box = "☐", checkedBox = "☑"

    private static func isSpace(_ c: Character?) -> Bool { c == nil || c!.isWhitespace }
    private static func isWord(_ c: Character?) -> Bool { guard let c else { return false }; return c.isLetter || c.isNumber || c == "_" }

    static func mergeRuns(_ runs: [NoteRun]) -> [NoteRun] {
        var out: [NoteRun] = []
        for r in runs where !r.text.isEmpty {
            if let last = out.last, last.sameStyle(r) { out[out.count - 1].text += r.text } else { out.append(r) }
        }
        return out
    }

    // MARK: parsing

    private static func re(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: o) }
    private static func groups(_ r: NSRegularExpression, _ s: String) -> [String]? {
        let ns = s as NSString
        guard let m = r.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
    }

    private static let tagRe = re(#"^<(/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*/?>"#)
    private static let linkRe = re(#"^\[([^\]]*)\]\(([^)\s]+)\)"#)
    private static let styleRe = re(#"style\s*=\s*("([^"]*)"|'([^']*)')"#, .caseInsensitive)
    private static let escapable: Set<Character> = Set("\\`*_~<>[]()#+-.!|")

    private static func parseStyle(_ css: String) -> (String?, Int?) {
        var font: String?, size: Int?
        for part in css.split(separator: ";") {
            let kv = part.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard kv.count == 2 else { continue }
            let v = kv[1].trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
            if v.isEmpty { continue }
            if kv[0].lowercased() == "font-family" {
                font = v.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "'\"")) }
            } else if kv[0].lowercased() == "font-size" {
                let digits = v.prefix { $0.isNumber || $0 == "." }
                if let n = Double(digits), n > 0 { size = Int((v.lowercased().hasSuffix("pt") ? n * 4 / 3 : n).rounded()) }
            }
        }
        return (font, size)
    }

    /// One line's inline Markdown into runs.
    static func parseInline(_ src: String) -> [NoteRun] {
        let c = Array(src)
        var runs: [NoteRun] = []
        var st = NoteRun(text: "")
        var spans: [(String?, Int?)] = []
        var text = ""
        func push() { if !text.isEmpty { runs.append(st.with(text)); text = "" } }
        var k = 0
        while k < c.count {
            let ch = c[k]
            if ch == "\\", k + 1 < c.count, escapable.contains(c[k + 1]) { text.append(c[k + 1]); k += 2; continue }
            if ch == "`", let end = c[(k + 1)...].firstIndex(of: "`"), end > k + 1 {
                push()
                var r = st.with(String(c[(k + 1)..<end])); r.code = true
                runs.append(r)
                k = end + 1
                continue
            }
            if ch == "*" || ch == "~" || ch == "_" {
                var n = 1
                while k + n < c.count && c[k + n] == ch { n += 1 }
                let prev: Character? = k > 0 ? c[k - 1] : nil
                let next: Character? = k + n < c.count ? c[k + n] : nil
                let flank = !(isSpace(prev) && isSpace(next))
                let wordOk = ch != "_" || !(isWord(prev) && isWord(next))
                if flank && wordOk && (ch != "~" || n == 2) {
                    push()
                    if ch == "~" { st.s.toggle() } else {
                        if n == 1 || n == 3 { st.i.toggle() }
                        if n == 2 || n == 3 { st.b.toggle() }
                        if n > 3 { text += String(c[k..<(k + n)]) }
                    }
                    k += n
                    continue
                }
                text += String(c[k..<(k + n)])
                k += n
                continue
            }
            if ch == "<", let g = groups(tagRe, String(c[k...])) {
                let close = g[1] == "/"
                let len = g[0].count
                switch g[2].lowercased() {
                case "u", "ins": push(); st.u = !close; k += len; continue
                case "b", "strong": push(); st.b = !close; k += len; continue
                case "i", "em": push(); st.i = !close; k += len; continue
                case "s", "del", "strike": push(); st.s = !close; k += len; continue
                case "span":
                    push()
                    if close { if let prev = spans.popLast() { st.font = prev.0; st.size = prev.1 } }
                    else {
                        spans.append((st.font, st.size))
                        let css = groups(styleRe, g[3]).map { $0[2].isEmpty ? $0[3] : $0[2] } ?? ""
                        let (f, z) = parseStyle(css)
                        if let f { st.font = f }
                        if let z { st.size = z }
                    }
                    k += len; continue
                case "br": k += len; continue
                default: break
                }
            }
            if ch == "[", let g = groups(linkRe, String(c[k...])) {
                push()
                var r = st.with(g[1].replacingOccurrences(of: #"\\(.)"#, with: "$1", options: .regularExpression)); r.href = g[2]
                runs.append(r)
                k += g[0].count
                continue
            }
            text.append(ch)
            k += 1
        }
        push()
        return mergeRuns(runs.map { r in
            var r = r
            if r.font == fonts[0] { r.font = nil }
            if r.size == defaultSize { r.size = nil }
            return r
        })
    }

    private static let fileRe = re(#"^\s*(!?)\[([^\]]*)\]\(([^)\s]+)\)\s*$"#)
    private static let todoRe = re(#"^(\s*)[-*+] \[([ xX])\] ?(.*)$"#)
    private static let ulRe = re(#"^(\s*)[-*+] (.*)$"#)
    private static let olRe = re(#"^(\s*)(\d{1,9})[.)] (.*)$"#)
    private static let hRe = re(#"^(#{1,6}) (.*)$"#)
    private static func indentOf(_ ws: String) -> Int { ws.replacingOccurrences(of: "\t", with: "    ").count / 2 }

    /// A whole note into lines.
    static func parse(_ md: String) -> [NoteLine] {
        md.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n").map { raw in
            if let f = groups(fileRe, raw), !f[1].isEmpty || f[3].hasPrefix("hgfile:") {
                let id = f[3].hasPrefix("hgfile:") ? String(f[3].dropFirst(7)) : nil
                var name = f[2]
                if name.hasPrefix("📎") { name = String(name.dropFirst()).trimmingCharacters(in: .whitespaces) }
                return NoteLine(kind: f[1].isEmpty ? "file" : "image", fileId: id, fileUrl: id == nil ? f[3] : nil, fileName: name)
            }
            if let g = groups(todoRe, raw) { return NoteLine(kind: "todo", indent: indentOf(g[1]), checked: g[2] != " ", runs: parseInline(g[3])) }
            if let g = groups(ulRe, raw) { return NoteLine(kind: "ul", indent: indentOf(g[1]), runs: parseInline(g[2])) }
            if let g = groups(olRe, raw) { return NoteLine(kind: "ol", indent: indentOf(g[1]), num: Int(g[2]) ?? 1, runs: parseInline(g[3])) }
            if let g = groups(hRe, raw) { return NoteLine(kind: "p", h: min(3, g[1].count), runs: parseInline(g[2])) }
            return NoteLine(kind: "p", runs: parseInline(raw))
        }
    }

    // MARK: writing

    private static let lineStartRe = re(#"^(\s*)([-+]|#{1,6}|\d{1,9}[.)])(?= )"#)

    private static func escapeText(_ t: String, atLineStart: Bool) -> String {
        let c = Array(t)
        var out = ""
        for (k, ch) in c.enumerated() {
            let prev: Character? = k > 0 ? c[k - 1] : nil
            let next: Character? = k + 1 < c.count ? c[k + 1] : nil
            if ch == "\\" || ch == "*" || ch == "`" || ch == "[" { out += "\\" + String(ch) }
            else if ch == "~" && (prev == "~" || next == "~") { out += "\\~" }
            else if ch == "<", let n = next, n.isLetter || n == "/" || n == "!" { out += "\\<" }
            else if ch == "_" && !(isWord(prev) && isWord(next)) { out += "\\_" }
            else { out.append(ch) }
        }
        if atLineStart, let g = groups(lineStartRe, out) {
            let mark = g[2]
            let fixed = g[1] + (mark.first!.isNumber ? String(mark.dropLast()) + "\\" + String(mark.last!) : "\\" + mark)
            out = fixed + String(out.dropFirst(g[0].count))
        }
        return out
    }

    private static func splitEdges(_ runs: [NoteRun]) -> [NoteRun] {
        runs.flatMap { r -> [NoteRun] in
            guard (r.b || r.i || r.s) && !r.code else { return [r] }
            let lead = r.text.prefix { $0.isWhitespace }
            let rest = r.text.dropFirst(lead.count)
            let trail = String(rest.reversed().prefix { $0.isWhitespace })
            let mid = rest.dropLast(trail.count)
            var plain = r; plain.b = false; plain.i = false; plain.s = false
            var out: [NoteRun] = []
            if !lead.isEmpty { out.append(plain.with(String(lead))) }
            if !mid.isEmpty { out.append(r.with(String(mid))) }
            if !trail.isEmpty { out.append(plain.with(trail)) }
            return out
        }
    }

    private static func spanOf(_ r: NoteRun) -> String {
        var parts: [String] = []
        if let f = r.font, f != fonts[0] { parts.append("font-family: \(f)") }
        if let z = r.size, z != defaultSize { parts.append("font-size: \(z)px") }
        return parts.joined(separator: "; ")
    }

    /// Runs into one line's inline Markdown.
    static func serializeInline(_ runs: [NoteRun], atLineStart: Bool = false) -> String {
        var out = ""
        var cb = false, ci = false, cs = false, cu = false, cspan = ""
        func to(_ wb: Bool, _ wi: Bool, _ ws: Bool, _ wu: Bool, _ wspan: String) {
            var toggles = ""
            if cs != ws { toggles += "~~" }
            let bb = cb != wb, ii = ci != wi
            toggles += bb && ii ? "***" : bb ? "**" : ii ? "*" : ""
            let offFirst = (!ws && cs) || (!wb && cb) || (!wi && ci)
            var tags = ""
            if cu && (!wu || cspan != wspan) { tags += "</u>"; cu = false }
            if !cspan.isEmpty && cspan != wspan { tags += "</span>"; cspan = "" }
            var open = ""
            if !wspan.isEmpty && cspan != wspan { open += "<span style=\"\(wspan)\">"; cspan = wspan }
            if wu && !cu { open += "<u>"; cu = true }
            out += offFirst ? toggles + tags + open : tags + open + toggles
            cb = wb; ci = wi; cs = ws
        }
        for (n, r) in splitEdges(mergeRuns(runs)).enumerated() {
            to(r.b, r.i, r.s, r.u, spanOf(r))
            var t = r.code && !r.text.contains("`") ? "`\(r.text)`" : escapeText(r.text, atLineStart: atLineStart && n == 0)
            if let href = r.href {
                let inner = r.code ? r.text.replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]") : t.replacingOccurrences(of: "]", with: "\\]")
                t = "[\(inner)](\(href))"
            }
            out += t
        }
        to(false, false, false, false, "")
        return out
    }

    /// Lines back into the note's Markdown.
    static func serialize(_ lines: [NoteLine]) -> String {
        lines.map { l in
            let pad = String(repeating: "  ", count: l.indent)
            switch l.kind {
            case "image": return l.fileId != nil ? "![\(l.fileName)](hgfile:\(l.fileId!))" : "![\(l.fileName)](\(l.fileUrl ?? ""))"
            case "file": return l.fileId != nil ? "[\(l.fileName)](hgfile:\(l.fileId!))" : "[\(l.fileName)](\(l.fileUrl ?? ""))"
            case "todo": return "\(pad)- [\(l.checked ? "x" : " ")] \(serializeInline(l.runs))"
            case "ul": return "\(pad)- \(serializeInline(l.runs))"
            case "ol": return "\(pad)\(l.num). \(serializeInline(l.runs))"
            default: return l.h > 0 ? String(repeating: "#", count: l.h) + " " + serializeInline(l.runs) : serializeInline(l.runs, atLineStart: true)
            }
        }.joined(separator: "\n")
    }

    /// Numbered lists counted again from 1, per run of numbered lines at the same indent.
    static func renumber(_ lines: [NoteLine]) -> [NoteLine] {
        var counters: [Int] = []
        return lines.map { l in
            var l = l
            if l.kind == "ol" {
                while counters.count > l.indent + 1 { counters.removeLast() }
                while counters.count < l.indent + 1 { counters.append(0) }
                counters[l.indent] += 1
                l.num = counters[l.indent]
            } else if l.kind == "p" && l.text.trimmingCharacters(in: .whitespaces).isEmpty {
                counters.removeAll()
            } else if l.kind != "ul" && l.kind != "todo" {
                counters.removeAll()
            }
            return l
        }
    }

    /// The words of a note without any markup: previews, search.
    static func plainText(_ md: String) -> String {
        parse(md).map { l in
            switch l.kind {
            case "image": return "[picture: \(l.fileName)]"
            case "file": return "[file: \(l.fileName)]"
            default: return String(repeating: "  ", count: l.indent) + prefixOf(l).trimmingCharacters(in: .whitespaces).appending(prefixOf(l).isEmpty ? "" : " ") + l.text
            }
        }.joined(separator: "\n")
    }

    /// One line, for a short preview.
    static func preview(_ md: String, max: Int = 140) -> String {
        String(plainText(md).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces).prefix(max))
    }

    // MARK: the editor's text: list lines carry their marker as text

    static func prefixOf(_ l: NoteLine) -> String {
        let pad = String(repeating: "  ", count: l.indent)
        switch l.kind {
        case "ul": return pad + bullet + " "
        case "todo": return pad + (l.checked ? checkedBox : box) + " "
        case "ol": return pad + "\(l.num). "
        default: return ""
        }
    }

    private static let prefixRe = re(#"^( *)(•|☐|☑|\d{1,9}\.) "#)

    /// prefix is in UTF-16 units (NSString), as the editor counts.
    static func kindOf(_ text: String) -> LineKind {
        guard let g = groups(prefixRe, text) else { return LineKind(kind: "p", indent: 0, prefix: 0) }
        let indent = g[1].count / 2
        let prefix = (g[0] as NSString).length
        switch g[2] {
        case bullet: return LineKind(kind: "ul", indent: indent, prefix: prefix)
        case box, checkedBox: return LineKind(kind: "todo", indent: indent, prefix: prefix, checked: g[2] == checkedBox)
        default: return LineKind(kind: "ol", indent: indent, prefix: prefix, num: Int(g[2].dropLast()) ?? 1)
        }
    }

    /// Enter at the end of a list line: what the next line starts with ("" ends the list, nil: not a list).
    static func continuePrefix(_ text: String) -> String? {
        let k = kindOf(text)
        if k.kind == "p" { return nil }
        if (text as NSString).substring(from: k.prefix).trimmingCharacters(in: .whitespaces).isEmpty { return "" }
        return prefixOf(NoteLine(kind: k.kind, indent: k.indent, num: k.num + 1))
    }
}
