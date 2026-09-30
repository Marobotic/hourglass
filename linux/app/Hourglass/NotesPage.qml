import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// All notes in one place. Left: All / No course / each course. Right: notes
// grouped by date; a course also shows its schedule and lecturers.
Item {
    id: page
    property var app
    property string sel: "all" // "all" | "inbox" | course id
    property var notes: []
    property string query: ""
    property var results: []
    readonly property var course: app.courses.find(c => c.id === sel) || null
    readonly property string today: app.nowData ? app.nowData.now.date : Util.dayOf(Date.now())

    function load() {
        Api.get("/api/notes", d => { if (d) page.notes = d.sort((a, b) => b.updated_at - a.updated_at); });
    }
    function search() {
        if (!query.trim()) { results = []; return; }
        Api.get("/api/notes/search?q=" + encodeURIComponent(query), d => { if (d) page.results = d; });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); if (page.query) page.search(); } }

    function countFor(key) {
        return notes.filter(n => key === "all" ? true : key === "inbox" ? !n.course_id : n.course_id === key).length;
    }

    // Notes for the selection, grouped: pinned, then by session date (newest
    // first), then undated.
    readonly property var groups: {
        const list = notes.filter(n => sel === "all" ? true : sel === "inbox" ? !n.course_id : n.course_id === sel);
        const pinned = list.filter(n => n.pinned);
        const by = {};
        for (const n of list.filter(n => !n.pinned)) { const k = n.session_date || ""; (by[k] = by[k] || []).push(n); }
        const keys = Object.keys(by).filter(k => k).sort().reverse();
        const out = [];
        if (pinned.length) out.push({ label: "Pinned", notes: pinned });
        for (const k of keys) out.push({ label: (k === page.today ? "Today · " : "") + Util.longDate(k), notes: by[k] });
        if (by[""]) out.push({ label: "No date", notes: by[""] });
        return out;
    }

    // New note in the current folder, stamped with a date you choose.
    function newNote(date) {
        const args = { date: date || page.today };
        if (course) args.course = course.id;
        page.app.newNote(args);
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Folders
        Rectangle {
            Layout.fillHeight: true
            Layout.preferredWidth: 340
            color: "transparent"
            Rectangle { anchors { right: parent.right; top: parent.top; bottom: parent.bottom } width: 1; color: Theme.border }
            ColumnLayout {
                anchors { fill: parent; margins: 20; topMargin: 32 }
                spacing: 10
                RowLayout {
                    Layout.fillWidth: true
                    Text { Layout.fillWidth: true; text: "Notes"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }
                    Btn { icon: "plus"; kind: "primary"; compact: true; tip: "New course"; onClicked: page.app.editCourse(null) }
                }
                Field {
                    id: searchField
                    Layout.fillWidth: true
                    placeholderText: "Search all notes"
                    onTextChanged: { page.query = text; searchTimer.restart(); }
                    Timer { id: searchTimer; interval: 250; onTriggered: page.search() }
                }

                FolderRow { label: "All notes"; glyph: "note"; current: page.sel === "all" && !page.query; count: page.countFor("all"); onClicked: { searchField.text = ""; page.sel = "all"; } }
                FolderRow { label: "No course"; glyph: "folder-open"; current: page.sel === "inbox" && !page.query; count: page.countFor("inbox"); onClicked: { searchField.text = ""; page.sel = "inbox"; } }
                Text { Layout.topMargin: 8; text: "COURSES"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.DemiBold; font.letterSpacing: 1.4 }
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 4
                    model: page.app.courses
                    delegate: FolderRow {
                        required property var modelData
                        width: ListView.view.width
                        current: page.sel === modelData.id && !page.query
                        count: page.countFor(modelData.id)
                        onClicked: { searchField.text = ""; page.sel = modelData.id; }
                        label: modelData.name
                        swatch: modelData.color
                        sub: [modelData.code, modelData.next ? Util.shortDate(modelData.next.date).slice(0, 3) + " " + modelData.next.start_time : ""].filter(x => x).join(" · ")
                    }
                }
            }
        }

        // Content
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true

            ColumnLayout {
                width: parent.width
                spacing: 0

                // search results
                ColumnLayout {
                    visible: page.query !== ""
                    Layout.fillWidth: true
                    Layout.margins: 32
                    spacing: 10
                    Text { text: page.results.length + " result" + (page.results.length === 1 ? "" : "s") + " for “" + page.query + "”"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.Bold }
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

                ColumnLayout {
                    visible: page.query === ""
                    Layout.fillWidth: true
                    Layout.margins: 32
                    spacing: 16

                    // header
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 14
                        Rectangle { visible: !!page.course; width: 6; Layout.fillHeight: true; radius: 3; color: page.course ? page.course.color : "transparent" }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 4
                            Text {
                                Layout.fillWidth: true
                                text: page.course ? page.course.name : page.sel === "inbox" ? "Notes without a course" : "All notes"
                                color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold
                            }
                            Text {
                                visible: !!page.course && text !== ""
                                text: page.course ? [page.course.code, page.course.location].filter(x => x).join("  ·  ") : ""
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
                            }
                            Text {
                                visible: !page.course
                                text: page.countFor(page.sel) + " notes"
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
                            }
                        }
                        Btn { visible: !!page.course; icon: "edit"; text: "Edit"; onClicked: page.app.editCourse(page.course) }
                    }

                    // lecturers
                    ColumnLayout {
                        visible: !!(page.course && page.course.teacher)
                        Layout.fillWidth: true
                        spacing: 6
                        Section { Layout.fillWidth: true; text: "Lecturers" }
                        Repeater {
                            model: page.course && page.course.teacher ? page.course.teacher.split(",").map(t => t.trim()).filter(t => t) : []
                            RowLayout {
                                required property string modelData
                                spacing: 10
                                Icon { name: "person"; size: 13; color: Theme.muted }
                                Text { text: modelData; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15 }
                            }
                        }
                    }

                    // schedule
                    ColumnLayout {
                        visible: !!page.course
                        Layout.fillWidth: true
                        spacing: 8
                        Section { Layout.fillWidth: true; text: "Weekly times" }
                        Repeater {
                            model: page.course ? page.course.events : []
                            Card {
                                required property var modelData
                                Layout.fillWidth: true
                                implicitHeight: 54
                                hoverable: true
                                onClicked: page.app.editEvent(modelData)
                                RowLayout {
                                    anchors { fill: parent; leftMargin: 14; rightMargin: 12 }
                                    spacing: 12
                                    Chip { text: Util.kindLabel(modelData.kind); tint: page.course ? page.course.color : Theme.muted }
                                    Text { text: modelData.start_time + " – " + modelData.end_time; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold }
                                    Text { Layout.fillWidth: true; text: Util.repeatText(modelData) + (modelData.location ? " · " + modelData.location : ""); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                                    Icon { name: "edit"; size: 13; color: Theme.faint }
                                }
                            }
                        }
                        Btn { icon: "plus"; text: "Add a weekly time"; kind: "subtle"; onClicked: page.app.editEvent(null, { course: page.course.id, repeatWeekly: true }) }
                    }

                    // new note with a date
                    Card {
                        Layout.fillWidth: true
                        implicitHeight: newRow.implicitHeight + 28
                        RowLayout {
                            id: newRow
                            anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 14; rightMargin: 14 }
                            spacing: 10
                            Icon { name: "note"; size: 15; color: Theme.muted }
                            Text { text: page.course ? "New note for" : "New note dated"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15 }
                            Btn { compact: true; icon: "left"; onClicked: dateField.text = Util.addDays(Util.isDate(dateField.text) ? dateField.text : page.today, -1) }
                            Field { id: dateField; Layout.preferredWidth: 130; text: page.today; invalid: !Util.isDate(text) }
                            Btn { compact: true; icon: "right"; onClicked: dateField.text = Util.addDays(Util.isDate(dateField.text) ? dateField.text : page.today, 1) }
                            Text { Layout.fillWidth: true; text: Util.isDate(dateField.text) ? Util.longDate(dateField.text) : ""; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                            Btn { kind: "primary"; icon: "plus"; text: "Write"; enabled: Util.isDate(dateField.text); onClicked: page.newNote(dateField.text) }
                        }
                    }

                    // notes by date
                    Repeater {
                        model: page.groups
                        ColumnLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            spacing: 8
                            Section { Layout.fillWidth: true; Layout.topMargin: 6; text: modelData.label; detail: modelData.notes.length + (modelData.notes.length === 1 ? " note" : " notes") }
                            Repeater {
                                model: modelData.notes
                                NoteCard {
                                    required property var modelData
                                    Layout.fillWidth: true
                                    note: Object.assign({ course_name: (page.app.courseById(modelData.course_id) || {}).name }, modelData)
                                    showCourse: !page.course
                                    tint: page.app.courseColor(modelData.course_id)
                                    onClicked: page.app.openNote(modelData)
                                }
                            }
                        }
                    }
                    Text {
                        visible: page.groups.length === 0
                        text: page.course ? "No notes yet. Notes you take during a session land here, grouped by date." : "No notes yet."
                        color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
                    }
                    Item { Layout.preferredHeight: 20 }
                }
            }
        }
    }
}
