import SwiftUI
import UIKit

// A note, written like a word processor: a UITextView showing the note as it
// reads (no Markdown on screen). Every character carries its style (the
// .hgStyle attribute, which typing carries over by itself); the font,
// underline and so on are drawn from it. List lines keep their marker as text
// ("• ", "☐ ", "1. "); a to-do's ☐/☑ is hidden under a themed box (a tap ticks
// it; a done item is dimmed and struck through, drawn only, so the note's own
// strike stays its own). Pictures are attachments in
// place. load() puts a note's Markdown in, markdown() reads it back out
// (NoteText.swift is the format).

extension NSAttributedString.Key {
    static let hgStyle = NSAttributedString.Key("hgStyle") // RunStyle of the character
    static let hgFile = NSAttributedString.Key("hgFile")   // a picture's Drive file id
    static let hgLook = NSAttributedString.Key("hgLook")   // drawn as a to-do: "box" (hidden ☐/☑) or "done"
}

// One character's style, as an attribute value (compared by value, so runs merge).
final class RunStyle: NSObject {
    let run: NoteRun
    init(_ run: NoteRun) { var r = run; r.text = ""; self.run = r }
    override func isEqual(_ object: Any?) -> Bool { (object as? RunStyle)?.run == run }
    override var hash: Int { "\(run.b)\(run.i)\(run.u)\(run.s)\(run.code)\(run.font ?? "")\(run.size ?? 0)\(run.href ?? "")".hashValue }
    static let plain = RunStyle(NoteRun(text: ""))
}

enum NoteFonts {
    private static let names: [String: (String, String)] = [
        "Inter": ("Inter-Regular", "Inter-Bold"),
        "Lora": ("Lora-Regular", "Lora-Bold"),
        "JetBrains Mono": ("JetBrainsMono-Regular", "JetBrainsMono-Bold"),
        "Caveat": ("Caveat-Regular", "Caveat-Bold"),
        "Playfair Display": ("PlayfairDisplay-Regular", "PlayfairDisplay-Bold"),
    ]
    static func ui(_ r: NoteRun) -> UIFont {
        let size = CGFloat(r.size ?? NoteFormat.defaultSize)
        let pair = r.code ? ("JetBrainsMonoNF-Regular", "JetBrainsMonoNF-Bold") : (names[r.font ?? NoteFormat.fonts[0]] ?? names["Inter"]!)
        return UIFont(name: r.b ? pair.1 : pair.0, size: size) ?? .systemFont(ofSize: size, weight: r.b ? .bold : .regular)
    }
    static func swiftUI(_ family: String, size: CGFloat) -> Font { .custom(names[family]?.0 ?? "Inter-Regular", size: size) }
}

enum RichConvert {
    static let fg = UIColor(H.fg)
    static let accent = UIColor(H.accent)

    /// The drawing attributes of a style.
    static func attributes(_ r: NoteRun) -> [NSAttributedString.Key: Any] {
        var a: [NSAttributedString.Key: Any] = [.hgStyle: RunStyle(r), .font: NoteFonts.ui(r), .foregroundColor: r.href != nil ? accent : fg]
        if r.u || r.href != nil { a[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if r.s { a[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        // The note fonts have no italic files: lean the letters instead.
        if r.i { a[.obliqueness] = 0.18 }
        let p = NSMutableParagraphStyle()
        p.lineSpacing = 3
        a[.paragraphStyle] = p
        return a
    }

    static func styleAt(_ s: NSAttributedString, _ i: Int) -> NoteRun {
        guard i >= 0, i < s.length else { return NoteRun(text: "") }
        return (s.attribute(.hgStyle, at: i, effectiveRange: nil) as? RunStyle)?.run ?? NoteRun(text: "")
    }

    /// A note's lines as the editor's text. width: pictures are scaled to it.
    static func attributed(_ lines: [NoteLine], width: CGFloat, image: (String) -> UIImage?) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let plain = attributes(NoteRun(text: ""))
        for (n, l) in lines.enumerated() {
            if n > 0 { out.append(NSAttributedString(string: "\n", attributes: plain)) }
            switch l.kind {
            case "image":
                let att = NSTextAttachment()
                let img = l.fileId.flatMap(image)
                att.image = img ?? UIImage(systemName: "photo")?.withTintColor(UIColor(H.muted), renderingMode: .alwaysOriginal)
                if let img { att.bounds = fit(img.size, width) } else { att.bounds = CGRect(x: 0, y: 0, width: 28, height: 22) }
                var a = plain
                a[.hgFile] = l.fileId ?? ""
                out.append(NSAttributedString(attachment: att))
                out.addAttributes(a, range: NSRange(location: out.length - 1, length: 1))
            case "file":
                var r = NoteRun(text: ""); r.href = "hgfile:" + (l.fileId ?? "")
                var a = attributes(r)
                a[.link] = r.href
                out.append(NSAttributedString(string: "📎 " + l.fileName, attributes: a))
            default:
                out.append(NSAttributedString(string: NoteFormat.prefixOf(l), attributes: plain))
                for r in l.runs {
                    var st = r
                    if l.h > 0 { st.b = true; st.size = NoteFormat.headingSizes[l.h] }
                    out.append(NSAttributedString(string: r.text, attributes: attributes(st)))
                }
            }
        }
        return out
    }

    static func fit(_ size: CGSize, _ width: CGFloat) -> CGRect {
        let w = min(size.width, max(80, width))
        let h = size.width > 0 ? size.height * w / size.width : size.height
        return CGRect(x: 0, y: 0, width: w, height: min(h, 520))
    }

    /// The editor's text back as the note's lines. names: Drive file id -> name.
    static func lines(_ s: NSAttributedString, names: [String: String]) -> [NoteLine] {
        let ns = s.string as NSString
        var out: [NoteLine] = []
        var start = 0
        while start <= ns.length {
            let nl = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start)).location
            let end = nl == NSNotFound ? ns.length : nl
            let range = NSRange(location: start, length: end - start)
            let text = ns.substring(with: range)
            // Pictures: each its own line.
            var pictures: [NoteLine] = []
            s.enumerateAttribute(.hgFile, in: range) { v, _, _ in
                if let id = v as? String, !id.isEmpty { pictures.append(NoteLine(kind: "image", fileId: id, fileName: names[id] ?? "picture")) }
            }
            out.append(contentsOf: pictures)
            let words = text.replacingOccurrences(of: "\u{FFFC}", with: "")
            if !pictures.isEmpty && words.trimmingCharacters(in: .whitespaces).isEmpty {
                start = end + 1
                continue
            }
            // A Drive file: a line that is only its link.
            var links = Set<String>(), plainChars = false
            s.enumerateAttribute(.link, in: range) { v, r, _ in
                let t = ns.substring(with: r).trimmingCharacters(in: .whitespaces)
                if t.isEmpty { return }
                if let v = v as? String ?? (v as? URL)?.absoluteString { links.insert(v) } else { plainChars = true }
            }
            if !plainChars, links.count == 1, let href = links.first, href.hasPrefix("hgfile:") {
                let id = String(href.dropFirst(7))
                var name = words.trimmingCharacters(in: .whitespaces)
                if name.hasPrefix("📎") { name = String(name.dropFirst()).trimmingCharacters(in: .whitespaces) }
                out.append(NoteLine(kind: "file", fileId: id, fileName: names[id] ?? name))
                start = end + 1
                continue
            }
            let k = NoteFormat.kindOf(text)
            var runs: [NoteRun] = []
            var i = start + k.prefix
            while i < end {
                let cr = ns.rangeOfComposedCharacterSequence(at: i)
                let ch = ns.substring(with: cr)
                if ch != "\u{FFFC}" { runs.append(styleAt(s, i).with(ch)) }
                i = cr.location + cr.length
            }
            runs = NoteFormat.mergeRuns(runs)
            var line = k.kind == "p" ? NoteLine(kind: "p", runs: runs) : NoteLine(kind: k.kind, indent: k.indent, num: k.num, checked: k.checked, runs: runs)
            if line.kind == "p" {
                let filled = runs.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
                if let first = filled.first, let size = first.size, let level = NoteFormat.headingSizes.firstIndex(of: size), level > 0,
                   filled.allSatisfy({ $0.b && $0.size == size && $0.font == nil }) {
                    line.h = level
                    line.runs = runs.map { var r = $0; r.b = false; r.size = nil; return r }
                }
            }
            out.append(line)
            if nl == NSNotFound { break }
            start = end + 1
        }
        return out
    }
}

// What the toolbar talks to: the text view, and the note's own bits.
@MainActor
final class RichNoteController: ObservableObject {
    weak var textView: UITextView?
    @Published var here = NoteRun(text: "")
    var names: [String: String] = [:]
    var onEdited: () -> Void = {}
    var onOpenFile: (String) -> Void = { _ in }
    var imageFor: (String) -> UIImage? = { _ in nil }
    private var pendingMarkdown: String?

    var width: CGFloat { max(120, (textView?.bounds.width ?? UIScreen.main.bounds.width - 40) - 16) }

    func load(_ md: String) {
        for l in NoteFormat.parse(md) where (l.kind == "image" || l.kind == "file") { if let id = l.fileId { names[id] = l.fileName } }
        guard let tv = textView else { pendingMarkdown = md; return }
        // Numbered lists show counted 1, 2, 3 (older notes may say 1, 1, 1).
        tv.attributedText = RichConvert.attributed(NoteFormat.renumber(NoteFormat.parse(md)), width: width, image: imageFor)
        tv.typingAttributes = RichConvert.attributes(NoteRun(text: ""))
        readHere()
        decorate()
    }
    func attach(_ tv: UITextView) {
        textView = tv
        if let md = pendingMarkdown { pendingMarkdown = nil; load(md) }
    }
    func markdown() -> String {
        guard let tv = textView else { return pendingMarkdown ?? "" }
        return NoteFormat.serialize(RichConvert.lines(tv.attributedText, names: names))
    }

    /// A picture arrived: show it where its placeholder is.
    func pictureLoaded(_ id: String) {
        guard let tv = textView, let img = imageFor(id) else { return }
        let s = tv.textStorage
        var at: [NSRange] = []
        s.enumerateAttribute(.hgFile, in: NSRange(location: 0, length: s.length)) { v, r, _ in if (v as? String) == id { at.append(r) } }
        for r in at {
            if let att = s.attribute(.attachment, at: r.location, effectiveRange: nil) as? NSTextAttachment {
                att.image = img
                att.bounds = RichConvert.fit(img.size, width)
                s.edited(.editedAttributes, range: r, changeInLength: 0)
            }
        }
    }

    // --- to-do boxes ----------------------------------------------------------------

    private var boxLayers: [CALayer] = []

    /// To-dos drawn as to-dos: each ☐/☑ hidden (with room after it) under a themed
    /// box, a done item's text dimmed and struck through. Run after every change.
    func decorate() {
        guard let tv = textView, tv.markedTextRange == nil else { return }
        let s = tv.textStorage
        let ns = s.string as NSString
        var looks: [(NSRange, String)] = []
        var boxes: [(Int, Bool)] = []
        var start = 0
        while start <= ns.length {
            let nl = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start)).location
            let end = nl == NSNotFound ? ns.length : nl
            let k = NoteFormat.kindOf(ns.substring(with: NSRange(location: start, length: end - start)))
            if k.kind == "todo" {
                let g = start + k.indent * 2
                looks.append((NSRange(location: g, length: 1), "box"))
                boxes.append((g, k.checked))
                if k.checked && end > g + 1 { looks.append((NSRange(location: g + 1, length: end - g - 1), "done")) }
            }
            if nl == NSNotFound { break }
            start = end + 1
        }
        let sel = tv.selectedRange
        let typing = tv.typingAttributes
        s.beginEditing()
        // What was drawn as a to-do before goes back to its own style first.
        var old: [NSRange] = []
        s.enumerateAttribute(.hgLook, in: NSRange(location: 0, length: s.length)) { v, r, _ in if v != nil { old.append(r) } }
        for r in old {
            s.enumerateAttribute(.hgStyle, in: r) { v, rr, _ in s.setAttributes(RichConvert.attributes((v as? RunStyle)?.run ?? NoteRun(text: "")), range: rr) }
        }
        for (r, look) in looks {
            if look == "box" { s.addAttributes([.foregroundColor: UIColor.clear, .kern: 6, .hgLook: look], range: r) }
            else { s.addAttributes([.foregroundColor: UIColor(H.muted), .strikethroughStyle: NSUnderlineStyle.single.rawValue, .hgLook: look], range: r) }
        }
        s.endEditing()
        tv.selectedRange = sel
        tv.typingAttributes = typing
        placeBoxes(boxes)
    }

    private func placeBoxes(_ boxes: [(Int, Bool)]) {
        guard let tv = textView else { return }
        while boxLayers.count > boxes.count { boxLayers.removeLast().removeFromSuperlayer() }
        while boxLayers.count < boxes.count {
            let l = CALayer()
            l.borderColor = UIColor(H.muted).cgColor
            let tick = CAShapeLayer()
            tick.strokeColor = UIColor.white.cgColor
            tick.fillColor = UIColor.clear.cgColor
            tick.lineWidth = 2
            tick.lineCap = .round
            tick.lineJoin = .round
            let path = UIBezierPath()
            path.move(to: CGPoint(x: 4, y: 8.5)); path.addLine(to: CGPoint(x: 7, y: 11.5)); path.addLine(to: CGPoint(x: 12.5, y: 5))
            tick.path = path.cgPath
            l.addSublayer(tick)
            tv.layer.addSublayer(l)
            boxLayers.append(l)
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for ((at, done), l) in zip(boxes, boxLayers) {
            guard let a = tv.position(from: tv.beginningOfDocument, offset: at), let b = tv.position(from: a, offset: 1), let r = tv.textRange(from: a, to: b) else { l.isHidden = true; continue }
            let rect = tv.firstRect(for: r)
            l.isHidden = rect.isNull || rect.isInfinite
            l.frame = CGRect(x: rect.minX, y: rect.midY - 8, width: 16, height: 16)
            l.backgroundColor = done ? UIColor(H.accent).cgColor : UIColor(H.bg).cgColor
            l.borderWidth = done ? 0 : 1
            l.sublayers?.first?.isHidden = !done
        }
        CATransaction.commit()
    }

    /// The cursor never sits between a to-do's hidden box and its space: what was typed there would not show.
    func keepOutOfBox() {
        guard let tv = textView, tv.selectedRange.length == 0 else { return }
        let ns = tv.attributedText.string as NSString
        let c = tv.selectedRange.location
        guard c > 0, c < ns.length, ns.substring(with: NSRange(location: c, length: 1)) == " " else { return }
        let before = ns.substring(with: NSRange(location: c - 1, length: 1))
        guard before == NoteFormat.box || before == NoteFormat.checkedBox else { return }
        let lr = ns.lineRange(for: NSRange(location: c, length: 0))
        let k = NoteFormat.kindOf(ns.substring(with: lr))
        if k.kind == "todo" && lr.location + k.indent * 2 == c - 1 { tv.selectedRange = NSRange(location: c + 1, length: 0) }
    }

    func readHere() {
        guard let tv = textView else { return }
        let r = tv.selectedRange
        if r.length == 0 { here = (tv.typingAttributes[.hgStyle] as? RunStyle)?.run ?? NoteRun(text: "") }
        else { here = RichConvert.styleAt(tv.attributedText, r.location) }
    }

    // Change the selection's characters, run by run (or, with nothing selected, what is typed next).
    func apply(_ change: (inout NoteRun) -> Void) {
        guard let tv = textView else { return }
        let sel = tv.selectedRange
        if sel.length == 0 {
            var st = (tv.typingAttributes[.hgStyle] as? RunStyle)?.run ?? NoteRun(text: "")
            change(&st)
            tv.typingAttributes = RichConvert.attributes(st)
            readHere()
            return
        }
        let s = tv.textStorage
        s.beginEditing()
        s.enumerateAttribute(.hgStyle, in: sel) { v, r, _ in
            if s.attribute(.attachment, at: r.location, effectiveRange: nil) != nil || s.attribute(.link, at: r.location, effectiveRange: nil) != nil { return }
            var st = (v as? RunStyle)?.run ?? NoteRun(text: "")
            change(&st)
            s.setAttributes(RichConvert.attributes(st), range: r)
        }
        s.endEditing()
        tv.selectedRange = sel
        readHere()
        onEdited()
    }

    /// Bold, italic, underline, strike: on unless the whole selection has it already.
    func toggle(_ key: String) {
        guard let tv = textView else { return }
        let sel = tv.selectedRange
        func has(_ r: NoteRun) -> Bool { key == "b" ? r.b : key == "i" ? r.i : key == "u" ? r.u : r.s }
        var on: Bool
        if sel.length == 0 { on = !has(here) } else {
            var all = true, any = false
            let ns = tv.attributedText.string as NSString
            tv.attributedText.enumerateAttribute(.hgStyle, in: sel) { v, r, _ in
                if ns.substring(with: r).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
                any = true
                if !has((v as? RunStyle)?.run ?? NoteRun(text: "")) { all = false }
            }
            on = !(any && all)
        }
        apply { r in if key == "b" { r.b = on } else if key == "i" { r.i = on } else if key == "u" { r.u = on } else { r.s = on } }
    }
    func setFont(_ f: String) { apply { $0.font = f == NoteFormat.fonts[0] ? nil : f; $0.code = false } }
    func setSize(_ z: Int) { apply { $0.size = z == NoteFormat.defaultSize ? nil : z } }

    // The lines the selection touches, as ranges (no "\n").
    private func linesTouched() -> [NSRange] {
        guard let tv = textView else { return [] }
        let ns = tv.attributedText.string as NSString
        let sel = tv.selectedRange
        var out: [NSRange] = []
        var a = ns.lineRange(for: NSRange(location: sel.location, length: 0)).location
        while true {
            let lr = ns.lineRange(for: NSRange(location: a, length: 0))
            var len = lr.length
            if len > 0, ns.substring(with: NSRange(location: lr.location + len - 1, length: 1)) == "\n" { len -= 1 }
            out.append(NSRange(location: lr.location, length: len))
            let next = lr.location + lr.length
            if next >= sel.location + sel.length || next >= ns.length || lr.length == 0 { break }
            a = next
        }
        return out
    }

    /// A heading: the whole line bold at the heading size. Again takes it off.
    func setHeading(_ level: Int) {
        guard let tv = textView else { return }
        let size = NoteFormat.headingSizes[level]
        let ns = tv.attributedText.string as NSString
        let lines = linesTouched().filter { !ns.substring(with: $0).trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty else { return }
        let bodies = lines.map { r -> NSRange in let k = NoteFormat.kindOf(ns.substring(with: r)); return NSRange(location: r.location + k.prefix, length: r.length - k.prefix) }
        var isOn = true
        for b in bodies {
            tv.attributedText.enumerateAttribute(.hgStyle, in: b) { v, r, _ in
                if ns.substring(with: r).trimmingCharacters(in: .whitespaces).isEmpty { return }
                let st = (v as? RunStyle)?.run ?? NoteRun(text: "")
                if !(st.b && st.size == size) { isOn = false }
            }
        }
        let sel = tv.selectedRange
        let s = tv.textStorage
        s.beginEditing()
        for b in bodies {
            s.enumerateAttribute(.hgStyle, in: b) { v, r, _ in
                var st = (v as? RunStyle)?.run ?? NoteRun(text: "")
                if isOn { st.b = false; st.size = nil } else { st.b = true; st.size = size }
                s.setAttributes(RichConvert.attributes(st), range: r)
            }
        }
        s.endEditing()
        tv.selectedRange = sel
        readHere()
        onEdited()
    }

    // Replace a range with plain text (list markers).
    private func replace(_ r: NSRange, with text: String) {
        guard let tv = textView else { return }
        tv.textStorage.replaceCharacters(in: r, with: NSAttributedString(string: text, attributes: RichConvert.attributes(NoteRun(text: ""))))
    }

    /// "• ", "☐ " or "1. " in front of every selected line; again takes it off.
    func setList(_ kind: String) {
        guard let tv = textView else { return }
        let ns = tv.attributedText.string as NSString
        let touched = linesTouched()
        let lines = touched.filter { touched.count == 1 || !ns.substring(with: $0).trimmingCharacters(in: .whitespaces).isEmpty }
        let all = lines.allSatisfy { NoteFormat.kindOf(ns.substring(with: $0)).kind == kind }
        var n = 0
        let edits = lines.map { r -> (NSRange, String) in
            let k = NoteFormat.kindOf(ns.substring(with: r))
            n += 1
            return (NSRange(location: r.location, length: k.prefix), all ? "" : NoteFormat.prefixOf(NoteLine(kind: kind, indent: k.kind == "p" ? 0 : k.indent, num: n)))
        }
        tv.textStorage.beginEditing()
        for (r, t) in edits.reversed() { replace(r, with: t) }
        tv.textStorage.endEditing()
        if let last = linesTouched().last { tv.selectedRange = NSRange(location: last.location + last.length, length: 0) }
        decorate()
        onEdited()
    }

    /// Enter: on a list line the next line starts the next item; on an empty item the list ends.
    /// True when it was handled here (the text view must not add the new line itself).
    func enter(at range: NSRange) -> Bool {
        guard let tv = textView, range.length == 0 else { return false }
        let ns = tv.attributedText.string as NSString
        let lr = ns.lineRange(for: NSRange(location: range.location, length: 0))
        let line = ns.substring(with: NSRange(location: lr.location, length: range.location - lr.location))
        let before = RichConvert.styleAt(tv.attributedText, range.location - 1)
        // A new line after a heading starts plain.
        let heading = before.b && before.size.map { NoteFormat.headingSizes.dropFirst().contains($0) } == true
        guard let next = NoteFormat.continuePrefix(line) else {
            if heading {
                tv.textStorage.replaceCharacters(in: range, with: NSAttributedString(string: "\n", attributes: RichConvert.attributes(NoteRun(text: ""))))
                tv.selectedRange = NSRange(location: range.location + 1, length: 0)
                tv.typingAttributes = RichConvert.attributes(NoteRun(text: ""))
                onEdited()
                return true
            }
            return false
        }
        if next.isEmpty {
            let k = NoteFormat.kindOf(line)
            replace(NSRange(location: lr.location, length: k.prefix), with: "")
            tv.selectedRange = NSRange(location: range.location - k.prefix, length: 0)
            onEdited()
            return true
        }
        var keep = before; keep.href = nil
        let text = NSMutableAttributedString(string: "\n" + next, attributes: RichConvert.attributes(NoteRun(text: "")))
        tv.textStorage.replaceCharacters(in: range, with: text)
        tv.selectedRange = NSRange(location: range.location + text.length, length: 0)
        tv.typingAttributes = RichConvert.attributes(keep)
        if next.first?.isNumber == true { renumber() }
        decorate()
        onEdited()
        return true
    }

    private func renumber() {
        guard let tv = textView else { return }
        let ns = tv.attributedText.string as NSString
        let texts = ns.components(separatedBy: "\n")
        let numbered = NoteFormat.renumber(texts.map { t in let k = NoteFormat.kindOf(t); return NoteLine(kind: k.kind, indent: k.indent, num: k.num) })
        var pos = 0
        var edits: [(NSRange, String)] = []
        for (i, t) in texts.enumerated() {
            let k = NoteFormat.kindOf(t)
            if k.kind == "ol" && numbered[i].num != k.num { edits.append((NSRange(location: pos, length: k.prefix), NoteFormat.prefixOf(numbered[i]))) }
            pos += (t as NSString).length + 1
        }
        let sel = tv.selectedRange
        var shift = 0
        for (r, t) in edits.reversed() {
            replace(r, with: t)
            if r.location < sel.location { shift += (t as NSString).length - r.length }
        }
        tv.selectedRange = NSRange(location: max(0, sel.location + shift), length: 0)
    }

    /// A tap: a to-do's box ticks, a picture or a Drive file opens. True when it did something.
    func tapped(at index: Int, point: CGPoint) -> Bool {
        guard let tv = textView else { return false }
        let ns = tv.attributedText.string as NSString
        for i in [index, index - 1] where i >= 0 && i < ns.length {
            let c = ns.substring(with: NSRange(location: i, length: 1))
            if c == NoteFormat.box || c == NoteFormat.checkedBox {
                let lr = ns.lineRange(for: NSRange(location: i, length: 0))
                let line = ns.substring(with: lr)
                let k = NoteFormat.kindOf(line)
                guard k.kind == "todo", lr.location + k.indent * 2 == i else { continue }
                // Only a tap on the box itself, not anywhere on the line.
                if let start = tv.position(from: tv.beginningOfDocument, offset: i), let end = tv.position(from: start, offset: 1),
                   let r = tv.textRange(from: start, to: end), !tv.firstRect(for: r).insetBy(dx: -10, dy: -8).contains(point) { continue }
                replace(NSRange(location: i, length: 1), with: c == NoteFormat.box ? NoteFormat.checkedBox : NoteFormat.box)
                decorate()
                onEdited()
                return true
            }
            if let id = tv.attributedText.attribute(.hgFile, at: i, effectiveRange: nil) as? String, !id.isEmpty { onOpenFile(id); return true }
            if let href = tv.attributedText.attribute(.link, at: i, effectiveRange: nil) as? String, href.hasPrefix("hgfile:") { onOpenFile(String(href.dropFirst(7))); return true }
        }
        return false
    }

    /// A picture or file after the cursor's line, on a line of its own.
    func insertFile(_ line: NoteLine) {
        guard let tv = textView else { return }
        if let id = line.fileId { names[id] = line.fileName }
        let ns = tv.attributedText.string as NSString
        let lr = ns.lineRange(for: NSRange(location: tv.selectedRange.location, length: 0))
        var at = lr.location + lr.length
        let block = NSMutableAttributedString()
        if at > 0 && (at > ns.length || ns.substring(with: NSRange(location: at - 1, length: 1)) != "\n") {
            block.append(NSAttributedString(string: "\n", attributes: RichConvert.attributes(NoteRun(text: ""))))
        }
        at = min(at, ns.length)
        block.append(RichConvert.attributed([line], width: width, image: imageFor))
        block.append(NSAttributedString(string: "\n", attributes: RichConvert.attributes(NoteRun(text: ""))))
        tv.textStorage.insert(block, at: at)
        tv.selectedRange = NSRange(location: at + block.length, length: 0)
        onEdited()
    }
}

/// The text view itself.
struct RichNoteEditor: UIViewRepresentable {
    @ObservedObject var controller: RichNoteController

    func makeCoordinator() -> Coordinator { Coordinator(controller) }

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.textColor = RichConvert.fg
        tv.tintColor = RichConvert.accent
        tv.font = NoteFonts.ui(NoteRun(text: ""))
        tv.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 60, right: 0)
        tv.textContainer.lineFragmentPadding = 0
        tv.keyboardDismissMode = .interactive
        tv.allowsEditingTextAttributes = false
        tv.delegate = context.coordinator
        tv.linkTextAttributes = [.foregroundColor: RichConvert.accent]
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        tv.addGestureRecognizer(tap)
        controller.attach(tv)
        return tv
    }

    // A new width wraps the text again: the to-do boxes follow.
    func updateUIView(_ tv: UITextView, context: Context) { Task { @MainActor in controller.decorate() } }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        let c: RichNoteController
        init(_ c: RichNoteController) { self.c = c }

        func textView(_ tv: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            if text == "\n" { return !c.enter(at: range) }
            return true
        }
        func textViewDidChange(_ tv: UITextView) { c.decorate(); c.onEdited() }
        func textViewDidChangeSelection(_ tv: UITextView) { c.keepOutOfBox(); c.readHere() }

        @objc func tap(_ g: UITapGestureRecognizer) {
            guard let tv = g.view as? UITextView else { return }
            let p = g.location(in: tv)
            guard let pos = tv.closestPosition(to: p) else { return }
            let i = tv.offset(from: tv.beginningOfDocument, to: pos)
            _ = c.tapped(at: i, point: p)
        }
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
