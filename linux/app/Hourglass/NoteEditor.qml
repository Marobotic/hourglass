import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs
import "noteformat.mjs" as NF

// A note, written like a word processor: what you see is the note. Select
// text and use the toolbar (font, size, bold, italic, underline, strike,
// heading, lists, to-dos), tick to-dos with a click, drop pictures in. It
// saves by itself 600 ms after the last change, and when you leave.
Rectangle {
    id: ed
    property var app
    property var note: null
    property string status: ""
    property string loadedId: ""
    property string savedBody: ""
    property var info: null // { file_base, key } once the service says
    color: Theme.bg

    readonly property var course: note && note.course_id ? app.courseById(note.course_id) : null

    // The note fonts, from the app's own files.
    Repeater {
        model: ["Inter", "Lora", "JetBrainsMono", "Caveat", "PlayfairDisplay"]
        Item {
            id: face
            required property string modelData
            FontLoader { source: Qt.resolvedUrl("fonts/" + face.modelData + "-Regular.ttf") }
            FontLoader { source: Qt.resolvedUrl("fonts/" + face.modelData + "-Bold.ttf") }
        }
    }

    Component.onCompleted: Api.get("/api/drive/info", d => { if (d) { ed.info = d; if (ed.loadedId && !saveTimer.running) body.load(ed.savedBody); } })

    onNoteChanged: {
        if (!note) { flush(); loadedId = ""; return; }
        if (note.id === loadedId) return;
        flush();
        loadedId = note.id;
        titleField.text = note.title || "";
        savedBody = note.body || "";
        body.load(savedBody);
        status = "";
        if (!note.body) body.editor.forceActiveFocus();
    }

    function flush() {
        if (!saveTimer.running || !loadedId) return;
        saveTimer.stop();
        save();
    }
    function save() {
        if (!loadedId) return;
        const md = body.markdown();
        const patch = { title: titleField.text };
        if (md !== savedBody) patch.body = md;
        savedBody = md;
        status = "Saving…";
        Api.put("/api/notes/" + loadedId, patch, () => ed.status = "Saved");
    }
    readonly property bool dated: !!(note && note.session_date)
    function move(patch) {
        flush();
        Api.put("/api/notes/" + loadedId, patch, n => { if (n) { ed.app.editingNote = n; ed.status = "Saved"; } });
    }
    function edited() { if (loadedId && !body.loading) { status = "Edited"; saveTimer.restart(); } }

    function openFile(id) {
        Api.get("/api/files/" + id + "/local", d => { if (d) Qt.openUrlExternally(d.url); });
    }

    // --- attachments: uploaded to the Drive, then shown in the note where the cursor is ---
    property string uploading: ""
    function attach(urls) {
        if (!urls.length) return;
        flush();
        const go = (folder, course) => {
            let left = urls.length;
            ed.uploading = left > 1 ? "Uploading " + left + " files…" : "Uploading…";
            for (const u of urls) {
                Api.request("POST", "/api/files/upload", { path: u.toString(), folder: folder, course: course || null, note: ed.loadedId }, (f, err) => {
                    if (f) ed.insertFile(f);
                    if (--left === 0) ed.uploading = err ? err : "";
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
    // A picture or file goes on its own line after the cursor's line.
    function insertFile(f) {
        const img = /^image\//.test(f.mime);
        const line = (img ? "![" + f.name + "]" : "[" + f.name + "]") + "(hgfile:" + f.id + ")";
        const md = body.markdown();
        const rows = md.split("\n");
        const t = body.editor.getText(0, body.editor.cursorPosition);
        let at = 0;
        for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 0x2029 || t.charCodeAt(i) === 0x2028) at++;
        rows.splice(Math.min(at + 1, rows.length), 0, line);
        body.load(rows.join("\n"));
        edited();
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
        z: -1
        keys: ["text/uri-list"]
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
    Shortcut { sequences: ["Ctrl+B"]; enabled: ed.visible; onActivated: body.toggle("b") }
    Shortcut { sequences: ["Ctrl+I"]; enabled: ed.visible; onActivated: body.toggle("i") }
    Shortcut { sequences: ["Ctrl+U"]; enabled: ed.visible; onActivated: body.toggle("u") }
    Shortcut { sequences: ["Ctrl+S"]; enabled: ed.visible; onActivated: { saveTimer.stop(); ed.save(); } }

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
                    Text { Layout.fillWidth: true; text: Util.preview(vr.modelData.body) || "(empty)"; color: Theme.fg; opacity: 0.8; wrapMode: Text.Wrap; maximumLineCount: 3; elide: Text.ElideRight; font.family: Theme.sans; font.pixelSize: 13 }
                }
                MouseArea {
                    id: vrMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                    onClicked: Api.action("restore_note_version", { version_id: vr.modelData.version_id }, n => {
                        if (!n) return;
                        versionsPop.close();
                        saveTimer.stop();
                        titleField.text = n.title || "";
                        ed.savedBody = n.body || "";
                        body.load(ed.savedBody);
                        ed.app.editingNote = n;
                        ed.status = "Restored";
                    })
                }
            }
        }
        footer: [Item { Layout.fillWidth: true }, Btn { text: "Close"; onClicked: versionsPop.close() }]
    }
    Timer { id: saveTimer; interval: 600; onTriggered: ed.save() }

    // The toolbar's font and size lists.
    component ListPick: Rectangle {
        id: lp
        property var options: [] // [{ label, value, family? }]
        property var value: null
        property int boxWidth: 150
        signal picked(var value)
        readonly property var current: options.find(o => o.value === value) || null
        implicitHeight: 28
        implicitWidth: boxWidth
        color: lpMouse.containsMouse ? Theme.surface2 : "transparent"
        border.width: 1
        border.color: lpPop.visible ? Theme.fg : Theme.border
        RowLayout {
            anchors { fill: parent; leftMargin: 9; rightMargin: 8 }
            spacing: 6
            Text { Layout.fillWidth: true; text: lp.current ? lp.current.label : String(lp.value); color: Theme.fg; elide: Text.ElideRight; font.family: lp.current && lp.current.family ? lp.current.family : Theme.mono; font.pixelSize: 13 }
            Icon { name: "down"; size: 10; color: Theme.muted }
        }
        MouseArea { id: lpMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: lpPop.open() }
        Popup {
            id: lpPop
            y: lp.height + 4
            width: Math.max(lp.width, 190)
            padding: 4
            height: Math.min(lpList.contentHeight + 8, 340)
            background: Rectangle { color: Theme.surface; border.color: Theme.border }
            ListView {
                id: lpList
                anchors.fill: parent
                clip: true
                model: lp.options
                delegate: Rectangle {
                    required property var modelData
                    width: lpList.width
                    height: 34
                    color: lpRow.containsMouse || modelData.value === lp.value ? Theme.surface2 : "transparent"
                    Text { anchors { left: parent.left; leftMargin: 10; verticalCenter: parent.verticalCenter } text: modelData.label; color: Theme.fg; font.family: modelData.family || Theme.mono; font.pixelSize: 16 }
                    MouseArea {
                        id: lpRow; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: { lpPop.close(); lp.picked(modelData.value); }
                    }
                }
            }
        }
    }

    ColumnLayout {
        anchors { fill: parent; margins: 28; topMargin: 22 }
        spacing: 12

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Btn { icon: "back"; text: "Back"; kind: "subtle"; onClicked: { ed.flush(); ed.app.editingNote = null; } }
            Item { Layout.fillWidth: true }
            Text { text: ed.uploading || ed.status; color: ed.uploading ? Theme.accent : Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
            Btn {
                icon: "pin"; compact: true; kind: "subtle"
                active: !!(ed.note && ed.note.pinned)
                tip: "Pin to every session"
                onClicked: Api.put("/api/notes/" + ed.loadedId, { pinned: !ed.note.pinned }, n => { if (n) ed.app.editingNote = n; })
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
            Btn { compact: true; kind: "subtle"; text: ed.dated ? "Clear date" : "Today"; onClicked: ed.move({ session_date: ed.dated ? null : Util.dayOf((ed.app && ed.app.clock) || Date.now()) }) }
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
            Keys.onReturnPressed: body.editor.forceActiveFocus()
        }

        // The toolbar: always there, it works on the selection (or what you type next).
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: tools.implicitHeight + 12
            color: Theme.surface
            border.width: 1
            border.color: Theme.border
            Flow {
                id: tools
                anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 6; rightMargin: 6 }
                spacing: 4
                component Tool: Btn { compact: true; kind: "subtle" }
                component Bar: Rectangle { width: 1; height: 22; color: Theme.border; y: 3 }
                ListPick {
                    boxWidth: 170
                    options: body.fonts.map(f => ({ label: f, value: f, family: f }))
                    value: body.here.font
                    onPicked: v => body.format({ font: v })
                }
                ListPick {
                    boxWidth: 64
                    options: body.sizes.map(s => ({ label: String(s), value: s }))
                    value: body.here.size
                    onPicked: v => body.format({ size: v })
                }
                Bar {}
                Tool { icon: "bold"; tip: "Bold (Ctrl+B)"; active: body.here.b; onClicked: body.toggle("b") }
                Tool { icon: "italic"; tip: "Italic (Ctrl+I)"; active: body.here.i; onClicked: body.toggle("i") }
                Tool { icon: "underline"; tip: "Underline (Ctrl+U)"; active: body.here.u; onClicked: body.toggle("u") }
                Tool { icon: "strike"; tip: "Strike through"; active: body.here.s; onClicked: body.toggle("s") }
                Bar {}
                Tool { icon: "heading"; text: "1"; tip: "Big heading"; onClicked: body.setHeading(1) }
                Tool { icon: "heading"; text: "2"; tip: "Heading"; onClicked: body.setHeading(2) }
                Tool { icon: "list-ul"; tip: "Bullet list"; onClicked: body.setList("ul") }
                Tool { icon: "list-ol"; tip: "Numbered list"; onClicked: body.setList("ol") }
                Tool { icon: "check-square"; tip: "To-do list (click a box to tick it)"; onClicked: body.setList("todo") }
                Bar {}
                Btn { compact: true; kind: "subtle"; icon: "image"; text: "Picture"; tip: "Add pictures (or drop them here)"; onClicked: { attachDialog.images = true; attachDialog.open(); } }
                Btn { compact: true; kind: "subtle"; icon: "clip"; text: "File"; tip: "Attach files (or drop them here)"; onClicked: { attachDialog.images = false; attachDialog.open(); } }
            }
        }

        RichNote {
            id: body
            Layout.fillWidth: true
            Layout.fillHeight: true
            info: ed.info
            onEdited: ed.edited()
            onOpenFile: id => ed.openFile(id)
        }
    }
}
