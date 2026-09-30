import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: page
    property var app
    property string selectedId: ""
    property var notes: []
    property string query: ""
    property var results: []
    readonly property var sel: app.courses.find(c => c.id === selectedId) || null

    function loadNotes() {
        if (!sel) { notes = []; return; }
        Api.action("get_notes", { course: sel.id, limit: 100 }, d => { if (d) page.notes = d; });
    }
    function search() {
        if (!query.trim()) { results = []; return; }
        Api.get("/api/notes/search?q=" + encodeURIComponent(query), d => { if (d) page.results = d; });
    }
    onSelChanged: loadNotes()
    Connections { target: Api; function onChanged() { page.loadNotes(); if (page.query) page.search(); } }
    Connections { target: page.app; function onCoursesChanged() { if (!page.sel && page.app.courses.length) page.selectedId = page.app.courses[0].id; } }
    Component.onCompleted: if (app.courses.length) selectedId = app.courses[0].id

    // notes grouped by session date, pinned first, then undated
    readonly property var groups: {
        const pinned = notes.filter(n => n.pinned);
        const rest = notes.filter(n => !n.pinned);
        const by = {};
        for (const n of rest) { const k = n.session_date || ""; (by[k] = by[k] || []).push(n); }
        const keys = Object.keys(by).sort().reverse();
        const out = [];
        if (pinned.length) out.push({ label: "Pinned", notes: pinned });
        for (const k of keys) out.push({ label: k ? Util.short(k) : "Course notes", notes: by[k] });
        return out;
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Course list
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: 280
            color: "transparent"
            Rectangle { anchors { right: parent.right; top: parent.top; bottom: parent.bottom } width: 1; color: Theme.border }
            ColumnLayout {
                anchors { fill: parent; margins: 20; topMargin: 32 }
                spacing: 10
                RowLayout {
                    Layout.fillWidth: true
                    Text { Layout.fillWidth: true; text: "Courses"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.Bold }
                    Btn { icon: "plus"; kind: "primary"; compact: true; onClicked: page.app.editCourse(null) }
                }
                Field {
                    id: searchField
                    Layout.fillWidth: true
                    placeholderText: "Search all notes"
                    onTextChanged: { page.query = text; searchTimer.restart(); }
                    Timer { id: searchTimer; interval: 250; onTriggered: page.search() }
                }
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.topMargin: 6
                    clip: true
                    spacing: 4
                    model: page.app.courses
                    delegate: Rectangle {
                        required property var modelData
                        readonly property bool current: modelData.id === page.selectedId && !page.query
                        width: ListView.view.width
                        height: 60
                        radius: Theme.radius
                        color: current ? Theme.surface2 : cMouse.containsMouse ? Theme.surface : "transparent"
                        RowLayout {
                            anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
                            spacing: 12
                            Rectangle { width: 12; height: 12; radius: 3; color: modelData.color }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2
                                Text { Layout.fillWidth: true; text: modelData.name; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.DemiBold }
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.next ? Util.short(modelData.next.date).slice(0, 3) + " " + modelData.next.start_time + (modelData.next.location ? " · " + modelData.next.location : "") : "No upcoming sessions"
                                    color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 11
                                }
                            }
                            Text { text: modelData.note_count; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12 }
                        }
                        MouseArea { id: cMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { searchField.text = ""; page.selectedId = modelData.id; } }
                    }
                }
            }
        }

        // Detail / search results
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true

            ColumnLayout {
                width: parent.width
                spacing: 18

                // search results
                ColumnLayout {
                    visible: page.query !== ""
                    Layout.fillWidth: true
                    Layout.margins: 32
                    spacing: 10
                    Text { text: page.results.length + " result" + (page.results.length === 1 ? "" : "s") + " for “" + page.query + "”"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 18; font.weight: Font.Bold }
                    Repeater {
                        model: page.results
                        NoteCard {
                            required property var modelData
                            Layout.fillWidth: true
                            note: modelData
                            showCourse: true
                            tint: page.app.courseColor(modelData.course_id)
                            onClicked: Api.get("/api/notes/" + modelData.id, n => { if (n) page.app.openNote(n); })
                        }
                    }
                }

                // empty
                ColumnLayout {
                    visible: page.query === "" && !page.sel
                    Layout.margins: 32
                    spacing: 10
                    Text { text: "No courses yet"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
                    Text { text: "A course is a folder: its weekly sessions and every note you take in them."; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                    Btn { kind: "primary"; icon: "plus"; text: "Add a course"; onClicked: page.app.editCourse(null) }
                }

                // course detail
                ColumnLayout {
                    visible: page.query === "" && !!page.sel
                    Layout.fillWidth: true
                    Layout.margins: 32
                    spacing: 18

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 14
                        Rectangle { width: 6; Layout.fillHeight: true; radius: 3; color: page.sel ? page.sel.color : "transparent" }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 3
                            Text { Layout.fillWidth: true; text: page.sel ? page.sel.name : ""; color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }
                            Text {
                                text: page.sel ? [page.sel.code, page.sel.location, page.sel.teacher].filter(x => x).join("  ·  ") : ""
                                visible: text !== ""
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                            }
                        }
                        Btn { icon: "edit"; text: "Edit"; onClicked: page.app.editCourse(page.sel) }
                        Btn { kind: "primary"; icon: "note"; text: "Note"; onClicked: page.app.newNote({ course: page.sel.id }) }
                    }

                    Section { Layout.fillWidth: true; text: "Schedule" }
                    Repeater {
                        model: page.sel ? page.sel.events : []
                        Card {
                            required property var modelData
                            Layout.fillWidth: true
                            implicitHeight: 54
                            hoverable: true
                            onClicked: page.app.editEvent(modelData)
                            RowLayout {
                                anchors { fill: parent; leftMargin: 14; rightMargin: 10 }
                                spacing: 12
                                Chip { text: Util.kindLabel(modelData.kind); tint: page.sel ? page.sel.color : Theme.muted }
                                Text { text: modelData.start_time + " – " + modelData.end_time; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.DemiBold }
                                Text { Layout.fillWidth: true; text: Util.repeatText(modelData) + (modelData.location ? " · " + modelData.location : ""); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12 }
                                Icon { name: "edit"; size: 12; color: Theme.faint }
                            }
                        }
                    }
                    Btn { icon: "plus"; text: "Add session time"; kind: "subtle"; onClicked: page.app.editEvent(null, { course: page.sel.id, repeatWeekly: true }) }

                    Repeater {
                        model: page.groups
                        ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            spacing: 8
                            Section { Layout.fillWidth: true; Layout.topMargin: 6; text: modelData.label; detail: modelData.notes.length + (modelData.notes.length === 1 ? " note" : " notes") }
                            Repeater {
                                model: modelData.notes
                                NoteCard { required property var modelData; Layout.fillWidth: true; note: modelData; onClicked: page.app.openNote(modelData) }
                            }
                        }
                    }
                    Text {
                        visible: page.sel && !page.notes.length
                        text: "No notes yet. Notes you take during a session land here, grouped by date."
                        color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
                    }
                }
            }
        }
    }
}
