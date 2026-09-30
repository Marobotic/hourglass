import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Full-page Markdown editor. Autosaves 600 ms after the last keystroke.
Rectangle {
    id: ed
    property var app
    property var note: null
    property bool preview: false
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
        preview = false;
        status = "";
        if (!note.body) body.area.forceActiveFocus(); else titleField.forceActiveFocus();
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
            Btn { icon: ed.preview ? "edit" : "eye"; text: ed.preview ? "Edit" : "Preview"; compact: true; onClicked: { ed.flush(); ed.preview = !ed.preview; } }
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
        Rectangle { Layout.fillWidth: true; height: 1; color: Theme.border }

        Area {
            id: body
            visible: !ed.preview
            Layout.fillWidth: true
            Layout.fillHeight: true
            placeholderText: "Write in Markdown. # headings, - lists, **bold**, `code`."
            fontSize: 15
            area.onTextChanged: if (area.activeFocus) ed.edited()
        }

        ScrollView {
            visible: ed.preview
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true
            Text {
                width: parent.width
                text: body.text || "*Nothing written yet.*"
                textFormat: Text.MarkdownText
                wrapMode: Text.Wrap
                color: Theme.fg
                linkColor: Theme.accent
                font.family: Theme.sans
                font.pixelSize: 15
                lineHeight: 1.25
                onLinkActivated: link => Qt.openUrlExternally(link)
            }
        }
    }
}
