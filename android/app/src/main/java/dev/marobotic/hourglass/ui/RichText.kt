package dev.marobotic.hourglass.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import dev.marobotic.hourglass.core.NoteFormat
import dev.marobotic.hourglass.core.NoteLine
import dev.marobotic.hourglass.core.Run

// One stretch of a note between pictures, as the editor holds it: the text as
// shown (list lines keep their marker in front: "• ", "☐ ", "1. ") and the
// style of every character. Typing keeps the styles in step; the toolbar
// changes them; toLines() turns it back into the note's lines.
class RichText(text: String = "", styles: List<Run>? = null) {
    var value by mutableStateOf(TextFieldValue(text))
    var styles by mutableStateOf(styles ?: List(text.length) { PLAIN })
    // Chosen with nothing selected: what the next thing typed here looks like.
    var pending by mutableStateOf<Run?>(null)
    var layout by mutableStateOf<TextLayoutResult?>(null)

    val text get() = value.text

    companion object {
        val PLAIN = Run("")

        fun fromLines(lines: List<NoteLine>): RichText {
            val sb = StringBuilder()
            val st = mutableListOf<Run>()
            lines.forEachIndexed { n, l ->
                if (n > 0) { sb.append('\n'); st.add(PLAIN) }
                val pre = NoteFormat.prefixOf(l)
                sb.append(pre); repeat(pre.length) { st.add(PLAIN) }
                for (r in l.runs) {
                    val style = (if (l.h > 0) r.copy(b = true, size = NoteFormat.HEADING_SIZES[l.h]) else r).copy(text = "")
                    sb.append(r.text); repeat(r.text.length) { st.add(style) }
                }
            }
            return RichText(sb.toString(), st)
        }

        private fun isHeading(r: Run) = r.b && r.size != null && r.size in NoteFormat.HEADING_SIZES.drop(1)
    }

    /** The note lines this text stands for. */
    fun toLines(): List<NoteLine> {
        val t = text
        val out = mutableListOf<NoteLine>()
        var start = 0
        for (line in t.split('\n')) {
            val end = start + line.length
            val k = NoteFormat.kindOf(line)
            val runs = NoteFormat.mergeRuns((start + k.prefix until end).map { i -> style(i).copy(text = t[i].toString()) })
            var l = if (k.kind == "p") NoteLine("p", runs = runs) else NoteLine(k.kind, k.indent, num = k.num, checked = k.checked, runs = runs)
            if (l.kind == "p") {
                val filled = runs.filter { it.text.isNotBlank() }
                val level = filled.firstOrNull()?.size?.let { NoteFormat.HEADING_SIZES.indexOf(it) } ?: -1
                if (level > 0 && filled.all { it.b && it.size == NoteFormat.HEADING_SIZES[level] && it.font == null }) {
                    l = l.copy(h = level, runs = runs.map { it.copy(b = false, size = null) })
                }
            }
            out.add(l)
            start = end + 1
        }
        return out
    }

    private fun style(i: Int) = styles.getOrNull(i) ?: PLAIN

    // What typed text looks like at `pos`: the character before it, unless that
    // ends a heading or a line (a new line starts plain after a heading).
    private fun typingStyle(pos: Int): Run {
        val t = text
        if (pos <= 0 || t.isEmpty()) return PLAIN
        val before = style(pos - 1)
        if (t[pos - 1] == '\n') return if (isHeading(before)) PLAIN else before
        return before
    }

    /** The format the toolbar shows: the selection's start, or what will be typed. */
    fun here(): Run = pending ?: value.selection.let { s -> if (s.collapsed) typingStyle(s.start) else style(s.min) }

    /**
     * A change from the text field. Styles follow the text (typed text takes
     * the style before it, or the pending one); Enter on a list line starts
     * the next item. True when the text changed.
     */
    fun onChange(new: TextFieldValue): Boolean {
        val old = value
        if (new.text == old.text) {
            if (pending != null && new.selection.start != old.selection.start) pending = null
            value = new
            return false
        }
        val a = old.text
        val b = new.text
        var p = 0
        while (p < a.length && p < b.length && a[p] == b[p]) p++
        var s = 0
        while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] == b[b.length - 1 - s]) s++
        val inserted = b.length - s - p
        val typed = pending ?: typingStyle(p)
        pending = null
        styles = styles.subList(0, minOf(p, styles.size)) + List(inserted) { typed } + styles.subList(minOf(a.length - s, styles.size), styles.size)
        value = new
        if (inserted == 1 && b[p] == '\n' && new.selection.collapsed && new.selection.start == p + 1) continueList(p)
        return true
    }

    private fun lineStart(pos: Int) = text.lastIndexOf('\n', pos - 1) + 1
    private fun lineEnd(pos: Int) = text.indexOf('\n', pos).let { if (it < 0) text.length else it }

    // Replace [a, b) with `with` (plain style), keeping the cursor where it belongs.
    private fun replace(a: Int, b: Int, with: String, cursor: Int? = null) {
        val t = text
        val nt = t.substring(0, a) + with + t.substring(b)
        styles = styles.subList(0, a) + List(with.length) { PLAIN } + styles.subList(b, styles.size)
        val shift = with.length - (b - a)
        fun move(x: Int) = if (x >= b) x + shift else if (x > a) a + with.length else x
        val sel = value.selection
        value = TextFieldValue(nt, cursor?.let { TextRange(it) } ?: TextRange(move(sel.start), move(sel.end)))
    }

    // Enter was typed at `nl` (the new line character's place).
    private fun continueList(nl: Int) {
        val ls = lineStart(nl)
        val line = text.substring(ls, nl)
        val next = NoteFormat.continuePrefix(line) ?: return
        if (next.isEmpty()) {
            // An empty item: Enter ends the list (the marker and the new line go).
            val k = NoteFormat.kindOf(line)
            replace(ls, nl + 1, line.substring(k.prefix), cursor = ls + line.length - k.prefix)
            return
        }
        replace(nl + 1, nl + 1, next, cursor = nl + 1 + next.length)
        if (NoteFormat.kindOf(next).kind == "ol") renumber()
    }

    /** Numbered lines counted 1, 2, 3 again. */
    fun renumber() {
        val lines = text.split('\n')
        val numbered = NoteFormat.renumber(lines.map { l -> NoteFormat.kindOf(l).let { k -> NoteLine(k.kind, k.indent, num = k.num, runs = listOf(Run(l.substring(k.prefix)))) } })
        var pos = 0
        val edits = mutableListOf<Triple<Int, Int, String>>()
        lines.forEachIndexed { n, l ->
            val k = NoteFormat.kindOf(l)
            if (k.kind == "ol" && numbered[n].num != k.num) edits.add(Triple(pos, pos + k.prefix, NoteFormat.prefixOf(numbered[n])))
            pos += l.length + 1
        }
        for ((a, b, w) in edits.asReversed()) replace(a, b, w)
    }

    // --- the toolbar ---

    private fun set(r: Run, key: String, on: Boolean) = when (key) {
        "b" -> r.copy(b = on); "i" -> r.copy(i = on); "u" -> r.copy(u = on); else -> r.copy(s = on)
    }
    private fun has(r: Run, key: String) = when (key) { "b" -> r.b; "i" -> r.i; "u" -> r.u; else -> r.s }

    // Change the selection's characters (or, with nothing selected, what is typed next).
    fun apply(change: (Run) -> Run) {
        val sel = value.selection
        if (sel.collapsed) { pending = change(here()); return }
        val t = text
        styles = styles.mapIndexed { i, st -> if (i >= sel.min && i < sel.max && t[i] != '\n') change(st) else st }
    }

    /** Bold, italic, underline, strike: on unless the whole selection has it already. */
    fun toggle(key: String) {
        val sel = value.selection
        val on = if (sel.collapsed) !has(here(), key) else !(sel.min until sel.max).filter { !text[it].isWhitespace() }.let { idx -> idx.isNotEmpty() && idx.all { has(style(it), key) } }
        apply { set(it, key, on) }
    }
    fun setFont(font: String) = apply { it.copy(font = font.takeIf { f -> f != NoteFormat.FONTS[0] }, code = false) }
    fun setSize(size: Int) = apply { it.copy(size = size.takeIf { z -> z != NoteFormat.DEFAULT_SIZE }) }

    private fun linesTouched(): List<IntRange> {
        val sel = value.selection
        val out = mutableListOf<IntRange>()
        var a = lineStart(sel.min)
        while (true) {
            val e = lineEnd(a)
            out.add(a until e)
            if (e >= sel.max || e >= text.length) break
            a = e + 1
        }
        return out
    }

    /** A heading: the whole line bold at the heading size. Again takes it off. */
    fun setHeading(level: Int) {
        val size = NoteFormat.HEADING_SIZES[level]
        val lines = linesTouched().filter { r -> text.substring(r.first, r.last + 1).isNotBlank() }
        if (lines.isEmpty()) return
        val body = lines.map { r -> (r.first + NoteFormat.kindOf(text.substring(r.first, r.last + 1)).prefix)..r.last }
        val on = !body.all { r -> r.filter { !text[it].isWhitespace() }.all { style(it).b && style(it).size == size } }
        styles = styles.mapIndexed { i, st -> if (body.any { i in it }) (if (on) st.copy(b = true, size = size) else st.copy(b = false, size = null)) else st }
    }

    /** "• ", "☐ " or "1. " in front of every selected line; again takes it off. */
    fun setList(kind: String) {
        val touched = linesTouched()
        val lines = touched.filter { touched.size == 1 || text.substring(it.first, it.last + 1).isNotBlank() }
        val all = lines.all { NoteFormat.kindOf(text.substring(it.first, it.last + 1)).kind == kind }
        var n = 0
        val edits = lines.map { r ->
            val k = NoteFormat.kindOf(text.substring(r.first, r.last + 1))
            Triple(r.first, r.first + k.prefix, if (all) "" else NoteFormat.prefixOf(NoteLine(kind, if (k.kind == "p") 0 else k.indent, num = ++n)))
        }
        for ((a, b, w) in edits.asReversed()) replace(a, b, w)
        if (kind == "ol") renumber()
    }

    /** Where each ☐ / ☑ is: what a tap ticks. */
    fun boxes(): List<Int> {
        val out = mutableListOf<Int>()
        var start = 0
        for (line in text.split('\n')) {
            val k = NoteFormat.kindOf(line)
            if (k.kind == "todo") out.add(start + k.indent * 2)
            start += line.length + 1
        }
        return out
    }

    fun toggleBox(at: Int) {
        val c = text.getOrNull(at)?.toString() ?: return
        val to = when (c) { NoteFormat.BOX -> NoteFormat.CHECKED; NoteFormat.CHECKED -> NoteFormat.BOX; else -> return }
        val sel = value.selection
        value = TextFieldValue(text.substring(0, at) + to + text.substring(at + 1), sel)
    }

    /** Split at the end of the cursor's line: this keeps the start, the result holds the rest (or null). */
    fun splitAfterCursorLine(): RichText? {
        val e = lineEnd(value.selection.max)
        if (e >= text.length) return null
        val rest = RichText(text.substring(e + 1), styles.subList(e + 1, styles.size))
        styles = styles.subList(0, e)
        value = TextFieldValue(text.substring(0, e), TextRange(e))
        return rest
    }
}
