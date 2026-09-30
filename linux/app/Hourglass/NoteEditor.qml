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
    function edited() { if (loadedId) { status = "Edited"; saveTimer.restart(); } }
    Timer { id: saveTimer; interval: 600; onTriggered: ed.save() }

    ColumnLayout {
        anchors { fill: parent; margins: 28; topMargin: 22 }
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            Btn { icon: "back"; text: "Back"; kind: "subtle"; onClicked: { ed.flush(); ed.app.editingNote = null; } }
            Rectangle { visible: !!ed.course; width: 10; height: 10; radius: 2; color: ed.course ? ed.course.color : "transparent"; Layout.leftMargin: 8 }
            Text { visible: !!ed.course; text: ed.course ? ed.course.name : ""; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
            Text {
                text: ed.note && ed.note.session_date ? "·  session " + Util.short(ed.note.session_date) : ed.course ? "·  course note" : "Inbox"
                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
            }
            Item { Layout.fillWidth: true }
            Text { text: ed.status; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11 }
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
