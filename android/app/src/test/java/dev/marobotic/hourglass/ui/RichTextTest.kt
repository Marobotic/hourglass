package dev.marobotic.hourglass.ui

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import dev.marobotic.hourglass.core.NoteFormat
import org.junit.Assert.assertEquals
import org.junit.Test

// The Android note editor's model: what typing and the toolbar do to a note.
class RichTextTest {
    private fun load(md: String) = RichText.fromLines(NoteFormat.parse(md))
    private fun md(rt: RichText) = NoteFormat.serialize(rt.toLines())
    private fun type(rt: RichText, s: String) {
        for (c in s) {
            val p = rt.value.selection.start
            val t = rt.text.substring(0, p) + c + rt.text.substring(p)
            rt.onChange(TextFieldValue(t, TextRange(p + 1)))
        }
    }
    private fun select(rt: RichText, a: Int, b: Int) { rt.onChange(rt.value.copy(selection = TextRange(a, b))) }

    @Test fun notesComeBackUnchanged() {
        for (n in listOf("# Title\nSome **bold** text", "- [ ] one\n- [x] two", "1. a\n2. b", "plain\n\nlines",
            "<span style=\"font-family: Caveat; font-size: 24px\">Hand</span> written", "## Head\n  - nested")) {
            assertEquals(n, md(load(n)))
        }
    }

    @Test fun enterContinuesAListAndEndsIt() {
        val rt = load("- first")
        select(rt, rt.text.length, rt.text.length)
        type(rt, "\nsec")
        assertEquals("- first\n- sec", md(rt))
        type(rt, "\n\nx")
        assertEquals("- first\n- sec\nx", md(rt))
        val ol = load("1. a")
        select(ol, ol.text.length, ol.text.length)
        type(ol, "\nb")
        assertEquals("1. a\n2. b", md(ol))
    }

    @Test fun boldOverASelectionKeepsEachFont() {
        val rt = load("hello world")
        select(rt, 0, 5)
        rt.toggle("b")
        assertEquals("**hello** world", md(rt))
        select(rt, 6, 11)
        rt.setFont("Lora"); rt.setSize(24)
        assertEquals("**hello** <span style=\"font-family: Lora; font-size: 24px\">world</span>", md(rt))
        select(rt, 0, 11)
        rt.toggle("b")
        assertEquals("**hello** <span style=\"font-family: Lora; font-size: 24px\">**world**</span>", md(rt))
        rt.toggle("b")
        assertEquals("hello <span style=\"font-family: Lora; font-size: 24px\">world</span>", md(rt))
    }

    @Test fun boldThenType() {
        val rt = load("a")
        select(rt, 1, 1)
        rt.toggle("b")
        type(rt, "b")
        assertEquals("a**b**", md(rt))
        // A new line after a heading starts plain.
        val h = load("# Big")
        select(h, h.text.length, h.text.length)
        type(h, "\nsmall")
        assertEquals("# Big\nsmall", md(h))
    }

    @Test fun listsHeadingsAndBoxes() {
        val rt = load("one\ntwo")
        select(rt, 0, rt.text.length)
        rt.setList("ol")
        assertEquals("1. one\n2. two", md(rt))
        select(rt, 0, rt.text.length)
        rt.setList("ol")
        assertEquals("one\ntwo", md(rt))
        select(rt, 0, 1)
        rt.setHeading(2)
        assertEquals("## one\ntwo", md(rt))
        rt.setHeading(2)
        assertEquals("one\ntwo", md(rt))
        select(rt, 0, rt.text.length)
        rt.setList("todo")
        assertEquals("- [ ] one\n- [ ] two", md(rt))
        rt.toggleBox(rt.boxes()[1])
        assertEquals("- [ ] one\n- [x] two", md(rt))
    }

    @Test fun deletingKeepsStylesInStep() {
        val rt = load("ab **cd** ef")
        // Delete "b " (positions 1..3).
        rt.onChange(TextFieldValue("a" + rt.text.substring(3), TextRange(1)))
        assertEquals("a**cd** ef", md(rt))
    }
}
