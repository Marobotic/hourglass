package dev.marobotic.hourglass.core

// Hourglass note text: a port of core/noteformat.js (the reference; its test,
// core/test/noteformat.test.js, is the spec NoteFormatTest.kt follows).
//
// A note is Markdown, one line per line, plus <u>underline</u> and
// <span style="font-family: Lora; font-size: 20px">…</span> for what Markdown
// has no syntax for. The editor parses a note into lines of styled runs,
// shows those, and serializes them back.

data class Run(
    val text: String,
    val b: Boolean = false,
    val i: Boolean = false,
    val u: Boolean = false,
    val s: Boolean = false,
    val code: Boolean = false,
    val font: String? = null,
    val size: Int? = null,
    val href: String? = null,
) {
    fun sameStyle(o: Run) = b == o.b && i == o.i && u == o.u && s == o.s && code == o.code && font == o.font && size == o.size && href == o.href
}

data class NoteLine(
    val kind: String = "p", // p | ul | ol | todo | image | file
    val indent: Int = 0,
    val h: Int = 0,
    val num: Int = 1,
    val checked: Boolean = false,
    val runs: List<Run> = emptyList(),
    val fileId: String? = null,
    val fileUrl: String? = null,
    val fileName: String = "",
) {
    val text get() = runs.joinToString("") { it.text }
}

data class LineKind(val kind: String, val indent: Int, val prefix: Int, val num: Int = 0, val checked: Boolean = false)

object NoteFormat {
    val FONTS = listOf("Inter", "Lora", "JetBrains Mono", "Caveat", "Playfair Display")
    val SIZES = listOf(12, 14, 15, 16, 18, 20, 24, 28, 32, 40)
    const val DEFAULT_SIZE = 15
    val HEADING_SIZES = listOf(0, 26, 21, 18)
    const val BULLET = "•"
    const val BOX = "☐"
    const val CHECKED = "☑"

    private fun isSpace(c: Char?) = c == null || c.isWhitespace()
    private fun isWord(c: Char?) = c != null && (c.isLetterOrDigit() || c == '_')

    fun mergeRuns(runs: List<Run>): List<Run> {
        val out = mutableListOf<Run>()
        for (r in runs) {
            if (r.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.sameStyle(r)) out[out.size - 1] = last.copy(text = last.text + r.text) else out.add(r)
        }
        return out
    }

    // --- parsing ---

    private fun parseStyle(css: String): Pair<String?, Int?> {
        var font: String? = null
        var size: Int? = null
        for (part in css.split(";")) {
            val k = part.substringBefore(":", "").trim().lowercase()
            val v = part.substringAfter(":", "").trim().trim('\'', '"')
            if (v.isEmpty()) continue
            if (k == "font-family") font = v.split(",")[0].trim().trim('\'', '"')
            else if (k == "font-size") {
                val n = Regex("""^[\d.]+""").find(v)?.value?.toDoubleOrNull() ?: continue
                if (n > 0) size = Math.round(if (v.endsWith("pt", true)) n * 4 / 3 else n).toInt()
            }
        }
        return font to size
    }

    private val TAG = Regex("""^<(/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*/?>""")
    private val LINK = Regex("""^\[([^\]]*)]\(([^)\s]+)\)""")
    private val STYLE_ATTR = Regex("""style\s*=\s*("([^"]*)"|'([^']*)')""", RegexOption.IGNORE_CASE)
    private const val ESCAPABLE = "\\`*_~<>[]()#+-.!|"

    /** One line's inline Markdown into runs. */
    fun parseInline(src: String): List<Run> {
        val runs = mutableListOf<Run>()
        var b = false; var i = false; var u = false; var s = false
        var font: String? = null; var size: Int? = null
        val spans = ArrayDeque<Pair<String?, Int?>>()
        val text = StringBuilder()
        fun style() = Run("", b, i, u, s, false, font, size, null)
        fun push() { if (text.isNotEmpty()) { runs.add(style().copy(text = text.toString())); text.clear() } }
        var k = 0
        while (k < src.length) {
            val c = src[k]
            if (c == '\\' && k + 1 < src.length && src[k + 1] in ESCAPABLE) { text.append(src[k + 1]); k += 2; continue }
            if (c == '`') {
                val end = src.indexOf('`', k + 1)
                if (end > k + 1) { push(); runs.add(style().copy(text = src.substring(k + 1, end), code = true)); k = end + 1; continue }
            }
            if (c == '*' || c == '~' || c == '_') {
                var n = 1
                while (k + n < src.length && src[k + n] == c) n++
                val prev = src.getOrNull(k - 1)
                val next = src.getOrNull(k + n)
                val flank = !(isSpace(prev) && isSpace(next))
                val wordOk = c != '_' || !(isWord(prev) && isWord(next))
                if (flank && wordOk && (c != '~' || n == 2)) {
                    push()
                    if (c == '~') s = !s
                    else {
                        if (n == 1 || n == 3) i = !i
                        if (n == 2 || n == 3) b = !b
                        if (n > 3) text.append(src, k, k + n)
                    }
                    k += n
                    continue
                }
                text.append(src, k, k + n)
                k += n
                continue
            }
            if (c == '<') {
                val m = TAG.find(src.substring(k))
                if (m != null) {
                    val close = m.groupValues[1] == "/"
                    when (val tag = m.groupValues[2].lowercase()) {
                        "u", "ins" -> { push(); u = !close; k += m.value.length; continue }
                        "b", "strong" -> { push(); b = !close; k += m.value.length; continue }
                        "i", "em" -> { push(); i = !close; k += m.value.length; continue }
                        "s", "del", "strike" -> { push(); s = !close; k += m.value.length; continue }
                        "span" -> {
                            push()
                            if (close) spans.removeLastOrNull()?.let { font = it.first; size = it.second }
                            else {
                                spans.addLast(font to size)
                                val st = STYLE_ATTR.find(m.groupValues[3])
                                val (f, z) = parseStyle(st?.let { it.groupValues[2].ifEmpty { it.groupValues[3] } } ?: "")
                                if (f != null) font = f
                                if (z != null) size = z
                            }
                            k += m.value.length; continue
                        }
                        "br" -> { k += m.value.length; continue }
                        else -> if (tag.isEmpty()) Unit
                    }
                }
            }
            if (c == '[') {
                val m = LINK.find(src.substring(k))
                if (m != null) {
                    push()
                    runs.add(style().copy(text = m.groupValues[1].replace(Regex("""\\(.)"""), "$1"), href = m.groupValues[2]))
                    k += m.value.length
                    continue
                }
            }
            text.append(c)
            k++
        }
        push()
        return mergeRuns(runs.map { it.copy(font = it.font?.takeIf { f -> f != FONTS[0] }, size = it.size?.takeIf { z -> z != DEFAULT_SIZE }) })
    }

    private val FILE_RE = Regex("""^\s*(!?)\[([^\]]*)]\(([^)\s]+)\)\s*$""")
    private val TODO_RE = Regex("""^(\s*)[-*+] \[([ xX])] ?(.*)$""")
    private val UL_RE = Regex("""^(\s*)[-*+] (.*)$""")
    private val OL_RE = Regex("""^(\s*)(\d{1,9})[.)] (.*)$""")
    private val H_RE = Regex("""^(#{1,6}) (.*)$""")
    private fun indentOf(ws: String) = ws.replace("\t", "    ").length / 2

    /** A whole note into lines. */
    fun parse(md: String): List<NoteLine> = md.replace("\r", "").split("\n").map { raw ->
        val f = FILE_RE.find(raw)
        if (f != null && (f.groupValues[1].isNotEmpty() || f.groupValues[3].startsWith("hgfile:"))) {
            val id = f.groupValues[3].takeIf { it.startsWith("hgfile:") }?.substring(7)
            return@map NoteLine(kind = if (f.groupValues[1].isNotEmpty()) "image" else "file", fileId = id, fileUrl = if (id == null) f.groupValues[3] else null,
                fileName = f.groupValues[2].replace(Regex("""^📎\s*"""), ""))
        }
        TODO_RE.find(raw)?.let { return@map NoteLine("todo", indentOf(it.groupValues[1]), checked = it.groupValues[2] != " ", runs = parseInline(it.groupValues[3])) }
        UL_RE.find(raw)?.let { return@map NoteLine("ul", indentOf(it.groupValues[1]), runs = parseInline(it.groupValues[2])) }
        OL_RE.find(raw)?.let { return@map NoteLine("ol", indentOf(it.groupValues[1]), num = it.groupValues[2].toInt(), runs = parseInline(it.groupValues[3])) }
        H_RE.find(raw)?.let { return@map NoteLine("p", h = minOf(3, it.groupValues[1].length), runs = parseInline(it.groupValues[2])) }
        NoteLine("p", runs = parseInline(raw))
    }

    // --- writing ---

    private fun escapeText(t: String, atLineStart: Boolean): String {
        val sb = StringBuilder()
        for ((k, c) in t.withIndex()) {
            when {
                c == '\\' || c == '*' || c == '`' || c == '[' -> sb.append('\\').append(c)
                c == '~' && (t.getOrNull(k - 1) == '~' || t.getOrNull(k + 1) == '~') -> sb.append("\\~")
                c == '<' && t.getOrNull(k + 1)?.let { it.isLetter() || it == '/' || it == '!' } == true -> sb.append("\\<")
                c == '_' && !(isWord(t.getOrNull(k - 1)) && isWord(t.getOrNull(k + 1))) -> sb.append("\\_")
                else -> sb.append(c)
            }
        }
        var out = sb.toString()
        if (atLineStart) {
            out = Regex("""^(\s*)([-+]|#{1,6}|\d{1,9}[.)])(?= )""").replace(out) { m ->
                val ws = m.groupValues[1]; val mark = m.groupValues[2]
                ws + if (mark[0].isDigit()) mark.dropLast(1) + "\\" + mark.last() else "\\" + mark
            }
        }
        return out
    }

    private fun splitEdges(runs: List<Run>): List<Run> = runs.flatMap { r ->
        if (!(r.b || r.i || r.s) || r.code) return@flatMap listOf(r)
        val lead = r.text.takeWhile { it.isWhitespace() }
        val rest = r.text.drop(lead.length)
        val trail = rest.takeLastWhile { it.isWhitespace() }
        val mid = rest.dropLast(trail.length)
        val plain = r.copy(b = false, i = false, s = false)
        listOfNotNull(lead.takeIf { it.isNotEmpty() }?.let { plain.copy(text = it) }, mid.takeIf { it.isNotEmpty() }?.let { r.copy(text = it) }, trail.takeIf { it.isNotEmpty() }?.let { plain.copy(text = it) })
    }

    private fun spanOf(r: Run): String = listOfNotNull(
        r.font?.takeIf { it != FONTS[0] }?.let { "font-family: $it" },
        r.size?.takeIf { it != DEFAULT_SIZE }?.let { "font-size: ${it}px" },
    ).joinToString("; ")

    /** Runs into one line's inline Markdown. */
    fun serializeInline(runs: List<Run>, atLineStart: Boolean = false): String {
        val out = StringBuilder()
        var cb = false; var ci = false; var cs = false; var cu = false; var cspan = ""
        fun to(wb: Boolean, wi: Boolean, ws: Boolean, wu: Boolean, wspan: String) {
            val toggles = StringBuilder()
            if (cs != ws) toggles.append("~~")
            val bb = cb != wb; val ii = ci != wi
            toggles.append(if (bb && ii) "***" else if (bb) "**" else if (ii) "*" else "")
            val offFirst = (!ws && cs) || (!wb && cb) || (!wi && ci)
            val tags = StringBuilder()
            if (cu && (!wu || cspan != wspan)) { tags.append("</u>"); cu = false }
            if (cspan.isNotEmpty() && cspan != wspan) { tags.append("</span>"); cspan = "" }
            val open = StringBuilder()
            if (wspan.isNotEmpty() && cspan != wspan) { open.append("<span style=\"").append(wspan).append("\">"); cspan = wspan }
            if (wu && !cu) { open.append("<u>"); cu = true }
            if (offFirst) out.append(toggles).append(tags).append(open) else out.append(tags).append(open).append(toggles)
            cb = wb; ci = wi; cs = ws
        }
        splitEdges(mergeRuns(runs)).forEachIndexed { n, r ->
            to(r.b, r.i, r.s, r.u, spanOf(r))
            var t = if (r.code && !r.text.contains('`')) "`${r.text}`" else escapeText(r.text, atLineStart && n == 0)
            if (r.href != null) t = "[" + (if (r.code) r.text.replace(Regex("""[\[\]]"""), "\\\\$0") else t.replace("]", "\\]")) + "](" + r.href + ")"
            out.append(t)
        }
        to(false, false, false, false, "")
        return out.toString()
    }

    /** Lines back into the note's Markdown. */
    fun serialize(lines: List<NoteLine>): String = lines.joinToString("\n") { l ->
        val pad = "  ".repeat(l.indent)
        when (l.kind) {
            "image" -> if (l.fileId != null) "![${l.fileName}](hgfile:${l.fileId})" else "![${l.fileName}](${l.fileUrl})"
            "file" -> if (l.fileId != null) "[${l.fileName}](hgfile:${l.fileId})" else "[${l.fileName}](${l.fileUrl})"
            "todo" -> "$pad- [${if (l.checked) "x" else " "}] ${serializeInline(l.runs)}"
            "ul" -> "$pad- ${serializeInline(l.runs)}"
            "ol" -> "$pad${l.num}. ${serializeInline(l.runs)}"
            else -> if (l.h > 0) "#".repeat(l.h) + " " + serializeInline(l.runs) else serializeInline(l.runs, true)
        }
    }

    /** Numbered lists counted again from 1, per run of numbered lines at the same indent. */
    fun renumber(lines: List<NoteLine>): List<NoteLine> {
        val counters = mutableListOf<Int>()
        return lines.map { l ->
            when {
                l.kind == "ol" -> {
                    while (counters.size > l.indent + 1) counters.removeAt(counters.size - 1)
                    while (counters.size < l.indent + 1) counters.add(0)
                    counters[l.indent] = counters[l.indent] + 1
                    l.copy(num = counters[l.indent])
                }
                l.kind == "p" && l.text.isBlank() -> { counters.clear(); l }
                l.kind != "ul" && l.kind != "todo" -> { counters.clear(); l }
                else -> l
            }
        }
    }

    /** The words of a note without any markup: previews, search, notifications. */
    fun plainText(md: String): String = parse(md).joinToString("\n") { l ->
        when (l.kind) {
            "image" -> "[picture: ${l.fileName}]"
            "file" -> "[file: ${l.fileName}]"
            else -> "  ".repeat(l.indent) + prefixOf(l).trimStart() + l.text
        }
    }

    /** One line, for a short preview. */
    fun preview(md: String, max: Int = 140) = plainText(md).replace(Regex("\\s+"), " ").trim().take(max)

    // --- the editor's text: list lines carry their marker as text ---

    fun prefixOf(l: NoteLine): String {
        val pad = "  ".repeat(l.indent)
        return when (l.kind) {
            "ul" -> "$pad$BULLET "
            "todo" -> pad + (if (l.checked) CHECKED else BOX) + " "
            "ol" -> "$pad${l.num}. "
            else -> ""
        }
    }

    private val PREFIX_RE = Regex("""^( *)(•|☐|☑|\d{1,9}\.) """)

    fun kindOf(text: String): LineKind {
        val m = PREFIX_RE.find(text) ?: return LineKind("p", 0, 0)
        val indent = m.groupValues[1].length / 2
        val mark = m.groupValues[2]
        val prefix = m.value.length
        return when (mark) {
            BULLET -> LineKind("ul", indent, prefix)
            BOX, CHECKED -> LineKind("todo", indent, prefix, checked = mark == CHECKED)
            else -> LineKind("ol", indent, prefix, num = mark.dropLast(1).toInt())
        }
    }

    /** Enter at the end of a list line: what the next line starts with ("" ends the list, null: not a list). */
    fun continuePrefix(text: String): String? {
        val k = kindOf(text)
        if (k.kind == "p") return null
        if (text.substring(k.prefix).isBlank()) return ""
        return prefixOf(NoteLine(k.kind, k.indent, num = k.num + 1))
    }
}
