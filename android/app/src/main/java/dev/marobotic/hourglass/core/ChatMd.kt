package dev.marobotic.hourglass.core

// What a chat message is made of beyond single lines: fenced code blocks and
// GitHub tables, plus the copy/quote forms of a message. Pure text, no UI.
object ChatMd {
    sealed class Block {
        // One source line; `index` is its line in the message (to-do boxes need it).
        data class Line(val index: Int, val text: String) : Block()
        data class Code(val lang: String, val code: String) : Block()
        data class Table(val header: List<String>, val aligns: List<Align>, val rows: List<List<String>>) : Block()
    }

    enum class Align { Left, Center, Right }

    private val FENCE = Regex("""^\s*(```+|~~~+)\s*([\w+#.-]*)[^`]*$""")
    private val DELIM = Regex("""^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$""")

    fun cells(line: String): List<String> {
        var s = line.trim()
        if (s.startsWith("|")) s = s.substring(1)
        if (s.endsWith("|") && !s.endsWith("\\|")) s = s.dropLast(1)
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (s[i] == '\\' && i + 1 < s.length && s[i + 1] == '|') { cur.append('|'); i += 2; continue }
            if (s[i] == '|') { out.add(cur.toString().trim()); cur.clear() } else cur.append(s[i])
            i++
        }
        out.add(cur.toString().trim())
        return out
    }

    private fun aligns(delimiter: String): List<Align> = cells(delimiter).map {
        when { it.startsWith(":") && it.endsWith(":") -> Align.Center; it.endsWith(":") -> Align.Right; else -> Align.Left }
    }

    private fun isTableStart(lines: List<String>, i: Int): Boolean {
        val head = lines[i]
        val delim = lines.getOrNull(i + 1) ?: return false
        return head.contains('|') && DELIM.matches(delim) && delim.contains('-') && cells(head).size == cells(delim).size
    }

    // An unclosed fence (an answer still streaming) runs to the end.
    fun blocks(text: String): List<Block> {
        val lines = text.split("\n")
        val out = mutableListOf<Block>()
        var i = 0
        while (i < lines.size) {
            val fence = FENCE.find(lines[i])
            if (fence != null) {
                val mark = fence.groupValues[1]
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !(lines[i].trim().startsWith(mark) && lines[i].trim().trimStart(mark[0]).isBlank())) { body.add(lines[i]); i++ }
                i++ // the closing fence
                out.add(Block.Code(fence.groupValues[2], body.joinToString("\n")))
            } else if (isTableStart(lines, i)) {
                val header = cells(lines[i])
                val al = aligns(lines[i + 1])
                var j = i + 2
                val rows = mutableListOf<List<String>>()
                while (j < lines.size && lines[j].isNotBlank() && lines[j].contains('|')) {
                    val row = cells(lines[j])
                    rows.add(List(header.size) { row.getOrElse(it) { "" } })
                    j++
                }
                out.add(Block.Table(header, al, rows))
                i = j
            } else {
                out.add(Block.Line(i, lines[i]))
                i++
            }
        }
        return out
    }

    // "> " before every line, then a blank line to type under.
    fun quote(text: String): String = text.trim().split("\n").joinToString("\n") { if (it.isBlank()) ">" else "> $it" } + "\n\n"

    // Markdown without its marks: what Copy puts on the clipboard.
    fun plain(md: String): String = blocks(md).joinToString("\n") { b ->
        when (b) {
            is Block.Code -> b.code
            is Block.Table -> (listOf(b.header) + b.rows).joinToString("\n") { it.joinToString("\t") { c -> inline(c) } }
            is Block.Line -> inline(b.text.replace(Regex("^#{1,6} "), "").replace(Regex("^(\\s*)[-*] \\[[ xX]] ")) { it.groupValues[1] + "• " })
        }
    }

    private fun inline(s: String): String = s
        .replace(Regex("""\*\*(.+?)\*\*"""), "$1").replace(Regex("""<u>(.+?)</u>"""), "$1").replace(Regex("""~~(.+?)~~"""), "$1")
        .replace(Regex("""\*(.+?)\*"""), "$1").replace(Regex("""\[([^\]]+)]\(([^)]+)\)""")) { if (it.groupValues[2].startsWith("hgfile:")) it.groupValues[1] else "${it.groupValues[1]} (${it.groupValues[2]})" }
}
