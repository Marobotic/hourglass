// The desktop note editor (RichNote.qml) driven like a person would: typing,
// Enter on a list, clicking a to-do box, bold over a selection.
//   windows/qt/bin/qmltestrunner.exe -import windows/app -input tools/qmltest
import QtQuick
import QtTest
import Hourglass

Item {
    width: 800; height: 600
    RichNote { id: rn; anchors.fill: parent }

    TestCase {
        name: "RichNote"
        when: windowShown

        function md() { return rn.markdown(); }

        function test_load_and_save_unchanged() {
            const notes = ["# Title\nSome **bold** text", "- [ ] one\n- [x] two", "1. a\n2. b", "plain\n\nlines"];
            for (const n of notes) { rn.load(n); compare(md(), n); }
        }

        function test_typing_and_enter_continues_a_list() {
            rn.load("- first");
            rn.editor.forceActiveFocus();
            rn.editor.cursorPosition = rn.editor.length;
            keyClick(Qt.Key_Return);
            wait(50);
            keyClick(Qt.Key_S); keyClick(Qt.Key_E); keyClick(Qt.Key_C);
            compare(md(), "- first\n- sec");
            // Enter on an empty item ends the list.
            keyClick(Qt.Key_Return);
            wait(50);
            keyClick(Qt.Key_Return);
            wait(50);
            keyClick(Qt.Key_X);
            compare(md(), "- first\n- sec\nx");
        }

        function test_click_ticks_a_todo() {
            rn.load("- [ ] buy milk");
            wait(50);
            const r = rn.editor.positionToRectangle(0);
            mouseClick(rn.editor, r.x + 4, r.y + r.height / 2);
            wait(50);
            compare(md(), "- [x] buy milk");
            mouseClick(rn.editor, r.x + 4, r.y + r.height / 2);
            wait(50);
            compare(md(), "- [ ] buy milk");
        }

        function test_bold_font_and_size_on_a_selection() {
            rn.load("hello world");
            rn.editor.select(0, 5);
            rn.toggle("b");
            compare(md(), "**hello** world");
            rn.editor.select(6, 11);
            rn.format({ font: "Lora", size: 24 });
            compare(md(), '**hello** <span style="font-family: Lora; font-size: 24px">world</span>');
            // Bold over both keeps each one's font.
            rn.editor.select(0, 11);
            rn.toggle("b");
            compare(md(), '**hello** <span style="font-family: Lora; font-size: 24px">**world**</span>');
            rn.editor.select(0, 11);
            rn.toggle("b");
            compare(md(), 'hello <span style="font-family: Lora; font-size: 24px">world</span>');
        }

        function test_bold_then_type() {
            rn.load("a");
            rn.editor.forceActiveFocus();
            rn.editor.cursorPosition = 1;
            rn.toggle("b");
            keyClick(Qt.Key_B);
            compare(md(), "a**b**");
        }

        function test_lists_and_headings_from_the_toolbar() {
            rn.load("one\ntwo");
            rn.editor.select(0, rn.editor.length);
            rn.setList("ol");
            compare(md(), "1. one\n2. two");
            rn.editor.select(0, rn.editor.length);
            rn.setList("ol");
            compare(md(), "one\ntwo");
            rn.editor.select(0, 1);
            rn.setHeading(2);
            compare(md(), "## one\ntwo");
            rn.editor.select(0, 1);
            rn.setHeading(2);
            compare(md(), "one\ntwo");
        }
    }
}
