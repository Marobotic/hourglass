package dev.marobotic.hourglass.core

import org.junit.Assert.assertEquals
import org.junit.Test

// Mirrors core/test/noteformat.test.js: the Kotlin port reads and writes notes
// exactly as the desktop and iOS do.
class NoteFormatTest {
    private fun round(md: String) = NoteFormat.serialize(NoteFormat.parse(md))

    @Test fun plainMarkdownReadsAsStyledRuns() {
        assertEquals(listOf(
            Run("a "), Run("bold", b = true), Run(" and "), Run("it", i = true), Run(" "),
            Run("under", u = true), Run(" "), Run("gone", s = true), Run(" "), Run("code", code = true),
        ), NoteFormat.parseInline("a **bold** and *it* <u>under</u> ~~gone~~ `code`"))
        assertEquals(listOf(Run("both", b = true, i = true)), NoteFormat.parseInline("***both***"))
        assertEquals(listOf(Run("it", i = true), Run(" snake_case")), NoteFormat.parseInline("_it_ snake_case"))
        assertEquals(listOf(Run("5 * 3")), NoteFormat.parseInline("5 * 3"))
        assertEquals(listOf(Run("see "), Run("site", href = "https://x.dev"), Run(" now")), NoteFormat.parseInline("see [site](https://x.dev) now"))
    }

    @Test fun fontsAndSizesTravelInASpan() {
        assertEquals(listOf(Run("big", font = "Lora", size = 20), Run(" small")),
            NoteFormat.parseInline("<span style=\"font-family: Lora; font-size: 20px\">big</span> small"))
        assertEquals(listOf(Run("x")), NoteFormat.parseInline("<span style=\"font-family: Inter; font-size: 15px\">x</span>"))
        assertEquals("<span style=\"font-family: Lora; font-size: 20px\">**big**</span> small",
            NoteFormat.serializeInline(listOf(Run("big", b = true, font = "Lora", size = 20), Run(" small"))))
    }

    @Test fun linesHeadingsListsTodosAttachments() {
        val lines = NoteFormat.parse("# Title\n- one\n  - nested\n1. first\n- [ ] todo\n- [x] done\n![pic.png](hgfile:11111111-2222-3333-4444-555555555555)\n[a.pdf](hgfile:11111111-2222-3333-4444-666666666666)\nplain")
        assertEquals(listOf("p" to 0, "ul" to 0, "ul" to 1, "ol" to 0, "todo" to 0, "todo" to 0, "image" to 0, "file" to 0, "p" to 0), lines.map { it.kind to it.indent })
        assertEquals(1, lines[0].h)
        assertEquals(true, lines[5].checked)
        assertEquals("11111111-2222-3333-4444-555555555555", lines[6].fileId)
        assertEquals("a.pdf", lines[7].fileName)
    }

    @Test fun roundTripsKeepTheNote() {
        for (md in listOf(
            "# Title\nSome **bold** and *italic* and <u>under</u> and ~~strike~~.",
            "- one\n  - two\n1. first\n2. second\n- [ ] todo\n- [x] done",
            "![pic.png](hgfile:11111111-2222-3333-4444-555555555555)",
            "<span style=\"font-family: Caveat; font-size: 24px\">Hand</span> written",
            "Stars \\* and \\_under\\_ and a \\[bracket",
            "snake_case stays",
            "",
            "a\n\nb",
        )) assertEquals(md, md, round(md))
    }

    @Test fun textThatLooksLikeMarkdownStaysText() {
        for (text in listOf("- not a list", "1. not numbered", "# not a heading", "a * b", "<b>tag</b>", "~~x~~", "[x](y)", "`tick`")) {
            val md = NoteFormat.serialize(listOf(NoteLine("p", runs = listOf(Run(text)))))
            assertEquals("$text -> $md", listOf(Run(text)), NoteFormat.parse(md)[0].runs)
            assertEquals("p", NoteFormat.parse(md)[0].kind)
        }
    }

    @Test fun mixedStylesSideBySide() {
        for (runs in listOf(
            listOf(Run("a", b = true), Run("b", b = true, i = true), Run("c", i = true), Run("d")),
            listOf(Run("x", i = true), Run("y", b = true)),
            listOf(Run("big", size = 24), Run("bold big", size = 24, b = true), Run(" under", u = true, font = "Lora")),
            listOf(Run("one", s = true, b = true), Run("two", s = true)),
        )) {
            val md = NoteFormat.serializeInline(runs)
            assertEquals(md, runs, NoteFormat.parseInline(md))
        }
    }

    @Test fun edgeSpacesMoveOutsideStars() {
        assertEquals("a **bold** c", NoteFormat.serializeInline(listOf(Run("a"), Run(" bold ", b = true), Run("c"))))
    }

    @Test fun plainText() {
        assertEquals("Hi\n☑ done\nbig\n[picture: p]",
            NoteFormat.plainText("# Hi\n- [x] done\n<span style=\"font-size: 20px\">**big**</span>\n![p](hgfile:11111111-2222-3333-4444-555555555555)"))
    }

    @Test fun editorPrefixesAndEnter() {
        assertEquals(LineKind("ul", 0, 2), NoteFormat.kindOf("• item"))
        assertEquals(LineKind("todo", 1, 4, checked = true), NoteFormat.kindOf("  ☑ done"))
        assertEquals(LineKind("ol", 0, 4, num = 12), NoteFormat.kindOf("12. x"))
        assertEquals("p", NoteFormat.kindOf("plain").kind)
        assertEquals("4. ", NoteFormat.continuePrefix("3. x"))
        assertEquals("☐ ", NoteFormat.continuePrefix("☑ x"))
        assertEquals("", NoteFormat.continuePrefix("• "))
        assertEquals(null, NoteFormat.continuePrefix("text"))
        assertEquals("  ☐ ", NoteFormat.prefixOf(NoteLine("todo", 1)))
    }

    @Test fun renumberCountsEachListFromOne() {
        val lines = NoteFormat.renumber(NoteFormat.parse("3. a\n7. b\n\n5. c\n  9. d\n6. e"))
        assertEquals(listOf(1, 2, 1, 1, 2), lines.filter { it.kind == "ol" }.map { it.num })
    }
}
