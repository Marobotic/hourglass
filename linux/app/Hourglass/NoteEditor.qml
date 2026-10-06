import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs

// A note, two ways: formatted to read (with boxes to tick on to-dos), or as
// Markdown to edit. Save shows the formatted note; Edit goes back. While
// editing it also autosaves 600 ms after the last keystroke.
Rectangle {
    id: ed
    property var app
    property var note: null
    property bool preview: false // true: the formatted note; false: editing
    property string status: ""
    property string loadedId: ""
    color: Theme.bg

    readonly property var course: note && note.course_id ? app.courseById(note.course_id) : null

    onNoteChanged: {
        if (!note) { flush(); loadedId = ""; return; }
        if (note.id === loadedId) return;
        loadedId = note.id;
        titleField.text = note.title || "";
        body.text = note.body || "";
        // A note with something in it opens ready to read; a new one opens to write.
        preview = !!note.body;
        status = "";
        if (!note.body) body.area.forceActiveFocus();
    }

    function flush() {
        if (!saveTimer.running || !loadedId) return;
        saveTimer.stop();
        save();
    }
    function save() {
        if (!loadedId) return;
        status = "Saving…";
        Api.put("/api/notes/" + loadedId, { title: titleField.text, body: body.text }, () => ed.status = "Saved");
    }
    readonly property bool dated: !!(note && note.session_date)
    function move(patch) {
        flush();
        Api.put("/api/notes/" + loadedId, patch, n => { if (n) { ed.app.editingNote = n; ed.status = "Saved"; } });
    }
    function edited() { if (loadedId) { status = "Edited"; saveTimer.restart(); } }

    // Save: numbered lists counted again, saved now, shown formatted.
    function saveAndView() {
        const tidy = Util.renumber(body.text);
        if (tidy !== body.text) body.text = tidy;
        saveTimer.stop();
        save();
        preview = true;
    }
    function startEditing() {
        preview = false;
        body.area.forceActiveFocus();
    }
    // Ticking a to-do in the formatted note rewrites its line and saves at once.
    function toggleTask(line) {
        const rows = body.text.split("\n");
        const m = Util.taskRe.exec(rows[line] || "");
        if (!m) return;
        rows[line] = rows[line].replace(/\[([ xX])\]/, m[2] === " " ? "[x]" : "[ ]");
        body.text = rows.join("\n");
        saveTimer.stop();
        save();
    }

    // --- formatting: the toolbar writes Markdown around the selection ---
    readonly property var ta: body.area
    function wrap(pre, post) {
        if (ed.preview) return;
        const a = ta.selectionStart, b = ta.selectionEnd;
        const sel = ta.text.slice(a, b);
        if (sel.startsWith(pre) && sel.endsWith(post) && sel.length >= pre.length + post.length) {
            ta.remove(a, b);
            ta.insert(a, sel.slice(pre.length, sel.length - post.length));
            ta.select(a, b - pre.length - post.length);
        } else {
            ta.remove(a, b);
            ta.insert(a, pre + sel + post);
            if (sel) ta.select(a, a + pre.length + sel.length + post.length);
            else ta.cursorPosition = a + pre.length;
        }
        ta.forceActiveFocus();
        edited();
    }
    // Prefix every selected line: "- ", "- [ ] ", numbers, or "## ". Again
    // removes it. Blank lines are left alone, and numbers count on from 1.
    function lines(kind) {
        if (ed.preview) return;
        const t = ta.text;
        const a = t.lastIndexOf("\n", ta.selectionStart - 1) + 1;
        let b = t.indexOf("\n", Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart ? 1 : 0), a));
        if (b < 0) b = t.length;
        const rows = t.slice(a, b).split("\n");
        const res = { ul: /^[-*] (?!\[[ xX]\] )/, todo: /^[-*] \[[ xX]\] /, ol: /^\d+\. /, h: /^#{1,6} / };
        const re = res[kind];
        const any = /^([-*] \[[ xX]\] |[-*] |\d+\. |#{1,6} )/;
        const filled = rows.filter(r => r.trim() !== "");
        const on = filled.length > 0 && filled.every(r => re.test(r));
        let n = 0;
        const out = rows.map(r => {
            if (r.trim() === "") return r;
            if (on) return r.replace(re, "");
            const prefix = kind === "ul" ? "- " : kind === "todo" ? "- [ ] " : kind === "ol" ? (++n) + ". " : "## ";
            return prefix + r.replace(any, "");
        });
        ta.remove(a, b);
        ta.insert(a, out.join("\n"));
        ta.cursorPosition = a + out.join("\n").length;
        if (kind === "ol") body.renumberKeepingCursor();
        ta.forceActiveFocus();
        edited();
    }

    // --- attachments: uploaded to the Drive ("Note attachments"), then a line in the note ---
    property string uploading: ""
    function attach(urls) {
        if (!urls.length) return;
        flush();
        const go = (folder, course) => {
            let left = urls.length;
            ed.uploading = left > 1 ? "Uploading " + left + " files…" : "Uploading…";
            for (const u of urls) {
                Api.request("POST", "/api/files/upload", { path: u.toString(), folder: folder, course: course || null, note: ed.loadedId }, (f, err) => {
                    if (f) {
                        const img = /^image\//.test(f.mime);
                        const line = (img ? "![" + f.name + "]" : "[" + f.name + "]") + "(hgfile:" + f.id + ")";
                        const t = ta.text, pos = ed.preview ? t.length : ta.cursorPosition;
                        const before = pos > 0 && t[pos - 1] !== "\n" ? "\n" : "";
                        ta.insert(pos, before + line + "\n");
                        ed.edited();
                    }
                    if (--left === 0) ed.uploading = err ? "" : "";
                }, true);
            }
        };
        if (ed.note && ed.note.course_id) return go(null, ed.note.course_id);
        Api.action("list_drive", {}, d => {
            const f = d && d.folders.find(x => x.name === "Note attachments");
            if (f) go(f.id);
            else Api.action("add_folder", { name: "Note attachments" }, n => { if (n) go(n.id); });
        });
    }
    FileDialog {
        id: attachDialog
        property bool images: false
        title: images ? "Add pictures" : "Attach files"
        fileMode: FileDialog.OpenFiles
        nameFilters: images ? ["Pictures (*.png *.jpg *.jpeg *.gif *.webp *.bmp)", "All files (*)"] : ["All files (*)"]
        onAccepted: ed.attach(selectedFiles)
    }
    // Drop pictures or files on the note to attach them.
    DropArea {
        id: noteDrop
        anchors.fill: parent
        z: 5
        onEntered: d => { if (d.hasUrls) d.accept(Qt.CopyAction); }
        onDropped: d => { if (!d.hasUrls) return; d.accept(Qt.CopyAction); ed.attach(d.urls); }
    }
    Rectangle {
        anchors.fill: parent
        z: 6
        visible: noteDrop.containsDrag
        color: Theme.alpha(Theme.accent, 0.12)
        border.width: 2
        border.color: Theme.accent
        Text { anchors.centerIn: parent; text: "Drop to attach to this note"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
    }
    Shortcut { sequences: ["Ctrl+B"]; enabled: ed.visible && !ed.preview; onActivated: ed.wrap("**", "**") }
    Shortcut { sequences: ["Ctrl+I"]; enabled: ed.visible && !ed.preview; onActivated: ed.wrap("*", "*") }
    Shortcut { sequences: ["Ctrl+U"]; enabled: ed.visible && !ed.preview; onActivated: ed.wrap("<u>", "</u>") }
    Shortcut { sequences: ["Ctrl+S"]; enabled: ed.visible && !ed.preview; onActivated: ed.saveAndView() }
    Shortcut { sequences: ["Ctrl+E"]; enabled: ed.visible && ed.preview; onActivated: ed.startEditing() }

    // Older text of this note, newest first; click one to put it back.
    Modal {
        id: versionsPop
        property var versions: []
        width: 620
        title: "Versions"
        subtitle: versions.length ? "Click one to restore it. What the note says now is kept as a version too." : "No older versions yet. They appear after edits."
        Repeater {
            model: versionsPop.versions
            Rectangle {
                id: vr
                required property var modelData
                Layout.fillWidth: true
                implicitHeight: vrCol.implicitHeight + 20
                color: vrMouse.containsMouse ? Theme.surface2 : "transparent"
                border.width: 1
                border.color: Theme.border
                ColumnLayout {
                    id: vrCol
                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 10 }
                    spacing: 4
                    Text {
                        text: Util.shortDate(Util.dayOf(vr.modelData.saved_at)) + " " + Util.clock(vr.modelData.saved_at) + (vr.modelData.reason === "conflict" ? "  ·  from another device" : vr.modelData.reason === "restore" ? "  ·  before a restore" : "")
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
                    }
                    Text { Layout.fillWidth: true; text: vr.modelData.title || "Untitled"; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.Bold }
                    Text { Layout.fillWidth: true; text: (vr.modelData.body || "(empty)").replace(/\s+/g, " "); color: Theme.fg; opacity: 0.8; wrapMode: Text.Wrap; maximumLineCount: 3; elide: Text.ElideRight; font.family: Theme.sans; font.pixelSize: 13 }
                }
                MouseArea {
                    id: vrMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                    onClicked: Api.action("restore_note_version", { version_id: vr.modelData.version_id }, n => {
                        if (!n) return;
                        versionsPop.close();
                        titleField.text = n.title || "";
                        body.text = n.body || "";
                        saveTimer.stop();
                        ed.app.editingNote = n;
                        ed.status = "Restored";
                    })
                }
            }
        }
        footer: [Item { Layout.fillWidth: true }, Btn { text: "Close"; onClicked: versionsPop.close() }]
    }
    Timer { id: saveTimer; interval: 600; onTriggered: ed.save() }

    ColumnLayout {
        anchors { fill: parent; margins: 28; topMargin: 22 }
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Btn { icon: "back"; text: "Back"; kind: "subtle"; onClicked: { ed.flush(); ed.app.editingNote = null; } }
            Item { Layout.fillWidth: true }
            Text { text: ed.status; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
            Btn {
                icon: "pin"; compact: true; kind: "subtle"
                active: !!(ed.note && ed.note.pinned)
                tip: "Pin to every session"
                onClicked: Api.put("/api/notes/" + ed.loadedId, { pinned: !ed.note.pinned }, n => { if (n) ed.app.editingNote = n; })
            }
            Btn {
                visible: ed.preview
                icon: "edit"; text: "Edit"; compact: true
                tip: "Edit this note (Ctrl+E, or double-click it)"
                onClicked: ed.startEditing()
            }
            Btn {
                visible: !ed.preview
                icon: "check"; text: "Save"; compact: true; kind: "primary"
                tip: "Save and show it formatted (Ctrl+S)"
                onClicked: ed.saveAndView()
            }
            Btn {
                icon: "time"; compact: true; kind: "subtle"
                text: "Versions"
                tip: "Older text of this note"
                onClicked: { ed.flush(); Api.action("note_versions", { note_id: ed.loadedId }, v => { if (v) { versionsPop.versions = v; versionsPop.open(); } }); }
            }
            Btn {
                icon: "trash"; compact: true; kind: "subtle"
                onClicked: ed.app.confirm("Delete note?", "“" + (titleField.text || "Untitled") + "” will be removed from every device.", "Delete", () => {
                    saveTimer.stop();
                    Api.action("delete_note", { note_id: ed.loadedId }, () => ed.app.editingNote = null);
                })
            }
        }

        // Which course and which day this note belongs to; changes save at once.
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Picker {
                Layout.preferredWidth: 260
                options: ed.app ? ed.app.courseOptions(true) : []
                value: ed.note ? ed.note.course_id || null : null
                onPicked: v => ed.move({ course_id: v })
            }
            Btn { compact: true; icon: "left"; enabled: ed.dated; onClicked: ed.move({ session_date: Util.addDays(ed.note.session_date, -1) }) }
            Field {
                id: dateF
                Layout.preferredWidth: 130
                placeholderText: "No date"
                text: ed.note && ed.note.session_date ? ed.note.session_date : ""
                invalid: text !== "" && !Util.isDate(text)
                onEditingFinished: if (text === "" || Util.isDate(text)) ed.move({ session_date: text || null })
            }
            Btn { compact: true; icon: "right"; enabled: ed.dated; onClicked: ed.move({ session_date: Util.addDays(ed.note.session_date, 1) }) }
            Text {
                Layout.fillWidth: true
                text: ed.dated ? Util.longDate(ed.note.session_date) : "Not tied to a day"
                color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14
            }
            Btn { compact: true; kind: "subtle"; text: ed.dated ? "Clear date" : "Today"; onClicked: ed.move({ session_date: ed.dated ? null : Util.dayOf(Date.now()) }) }
        }

        TextField {
            id: titleField
            Layout.fillWidth: true
            placeholderText: "Title"
            color: Theme.fg
            placeholderTextColor: Theme.faint
            font.family: Theme.mono
            font.pixelSize: 28
            font.weight: Font.Bold
            background: null
            leftPadding: 0
            onTextEdited: ed.edited()
            Keys.onReturnPressed: body.area.forceActiveFocus()
        }
        // formatting toolbar, while editing
        RowLayout {
            Layout.fillWidth: true
            visible: !ed.preview
            spacing: 4
            component Tool: Btn { compact: true; kind: "subtle" }
            Tool { icon: "bold"; tip: "Bold (Ctrl+B)"; onClicked: ed.wrap("**", "**") }
            Tool { icon: "italic"; tip: "Italic (Ctrl+I)"; onClicked: ed.wrap("*", "*") }
            Tool { icon: "underline"; tip: "Underline (Ctrl+U)"; onClicked: ed.wrap("<u>", "</u>") }
            Tool { icon: "strike"; tip: "Strike through"; onClicked: ed.wrap("~~", "~~") }
            Rectangle { width: 1; height: 22; color: Theme.border }
            Tool { icon: "heading"; tip: "Heading"; onClicked: ed.lines("h") }
            Tool { icon: "list-ul"; tip: "Bullet list"; onClicked: ed.lines("ul") }
            Tool { icon: "list-ol"; tip: "Numbered list"; onClicked: ed.lines("ol") }
            Tool { icon: "check-square"; tip: "To-do list"; onClicked: ed.lines("todo") }
            Rectangle { width: 1; height: 22; color: Theme.border }
            Btn { compact: true; kind: "subtle"; icon: "image"; text: "Picture"; tip: "Add pictures (or drop them here)"; onClicked: { attachDialog.images = true; attachDialog.open(); } }
            Btn { compact: true; kind: "subtle"; icon: "clip"; text: "File"; tip: "Attach files (or drop them here)"; onClicked: { attachDialog.images = false; attachDialog.open(); } }
            Text { text: ed.uploading; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
            Item { Layout.fillWidth: true }
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 24

            Area {
                id: body
                visible: !ed.preview
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredWidth: 1
                placeholderText: "Write here. Select text and use the buttons above for bold, lists and more."
                fontSize: 15
                smartLists: true
                area.onTextChanged: if (area.activeFocus) ed.edited()
            }

            // How it reads, once saved.
            ScrollView {
                visible: ed.preview
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.preferredWidth: 1
                contentWidth: availableWidth
                clip: true
                NoteView {
                    width: parent.width
                    app: ed.app
                    text: body.text || "*Nothing written yet. Press Edit to write.*"
                    onToggleTask: line => ed.toggleTask(line)
                    onEditRequested: ed.startEditing()
                }
            }
        }
    }
}
