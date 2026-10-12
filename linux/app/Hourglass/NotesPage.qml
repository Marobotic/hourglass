import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Notes like Google Keep: a quick "Take a note" bar, a course dropdown to filter,
// and a masonry grid of cards tinted with the course colour.
Item {
    id: page
    property var app
    property string sel: "all" // "all" | "inbox" | course id
    property var notes: []
    property string query: ""
    readonly property var course: app.courses.find(c => c.id === sel) || null
    readonly property string today: app.nowData ? app.nowData.now.date : Util.dayOf(Date.now())
    readonly property int cols: Math.max(1, Math.floor((width - 80 + 12) / (280 + 12)))

    function load() {
        Api.get("/api/notes", d => { if (d) page.notes = d; });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }

    readonly property var shown: {
        const q = query.trim().toLowerCase().split(/\s+/).filter(w => w);
        return notes
            .filter(n => sel === "all" ? true : sel === "inbox" ? !n.course_id : n.course_id === sel)
            .filter(n => !q.length || q.every(w => (n.title + "\n" + Util.plain(n.body)).toLowerCase().includes(w)))
            .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at));
    }

    // Masonry: each card goes to the currently shortest column.
    function estimate(n) {
        const lines = Math.min(10, Math.ceil((n.body || "").length / 34) + (n.body || "").split("\n").length - 1);
        return 70 + (n.title ? 24 : 0) + lines * 20;
    }
    readonly property var columns: {
        const out = [], h = [];
        for (let i = 0; i < cols; i++) { out.push([]); h.push(0); }
        for (const n of shown) {
            let k = 0;
            for (let i = 1; i < cols; i++) if (h[i] < h[k]) k = i;
            out[k].push(n);
            h[k] += estimate(n) + 12;
        }
        return out;
    }

    function newNote() {
        const args = { date: page.today };
        if (course) args.course = course.id;
        page.app.newNote(args);
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 18

            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 40
                Layout.bottomMargin: 0
                spacing: 16

                RowLayout {
                    Layout.fillWidth: true
                    Text { Layout.fillWidth: true; text: "Notes"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold }
                    Field { Layout.preferredWidth: 260; placeholderText: "Search"; onTextChanged: page.query = text }
                }

                // "All" first, then each subject: one dropdown.
                RowLayout {
                    spacing: 8
                    Picker {
                        Layout.preferredWidth: 320
                        options: [{ label: "All notes", value: "all" }].concat(page.app.courses.map(c => ({ label: c.name, value: c.id, color: c.color })), [{ label: "No course", value: "inbox" }])
                        value: page.sel
                        onPicked: v => page.sel = v
                    }
                    Btn { compact: true; kind: "subtle"; icon: "plus"; text: "Course"; onClicked: page.app.editCourse(null) }
                }

                // selected course, one quiet line
                RowLayout {
                    visible: !!page.course
                    spacing: 12
                    Text {
                        text: page.course ? [page.course.name, page.course.location, Util.lead(page.course.teacher)].filter(x => x).join("  ·  ") : ""
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
                    }
                    Text {
                        text: "Edit"
                        color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14; font.underline: editMouse.containsMouse
                        MouseArea { id: editMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.editCourse(page.course) }
                    }
                }

                // take a note
                Rectangle {
                    Layout.fillWidth: true
                    Layout.maximumWidth: 640
                    Layout.alignment: Qt.AlignHCenter
                    height: 48
                    color: takeMouse.containsMouse ? Theme.surface2 : Theme.surface
                    border.width: 1
                    border.color: takeMouse.containsMouse ? Theme.faint : Theme.border
                    RowLayout {
                        anchors { fill: parent; leftMargin: 16; rightMargin: 16 }
                        Text { Layout.fillWidth: true; text: page.course ? "Take a note for " + page.course.name + "…" : "Take a note…"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                        Icon { name: "note"; size: 15; color: Theme.muted }
                    }
                    MouseArea { id: takeMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.newNote() }
                }
            }

            // masonry grid
            Row {
                Layout.leftMargin: 40
                Layout.rightMargin: 40
                Layout.bottomMargin: 40
                spacing: 12
                readonly property real colW: (page.width - 80 - (page.cols - 1) * 12) / page.cols
                Repeater {
                    model: page.columns
                    Column {
                        required property var modelData
                        width: parent.colW
                        spacing: 12
                        Repeater {
                            model: modelData
                            Rectangle {
                                id: card
                                required property var modelData
                                readonly property var c: page.app.courseById(modelData.course_id)
                                width: parent.width
                                height: cardCol.implicitHeight + 28
                                color: c ? Theme.mix(Theme.bg, Qt.color(c.color), cardMouse.containsMouse ? 0.2 : 0.13) : (cardMouse.containsMouse ? Theme.surface2 : Theme.surface)
                                border.width: 1
                                border.color: cardMouse.containsMouse ? Theme.faint : c ? Theme.alpha(c.color, 0.45) : Theme.border
                                ColumnLayout {
                                    id: cardCol
                                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 14 }
                                    spacing: 8
                                    RowLayout {
                                        Layout.fillWidth: true
                                        visible: !!card.modelData.title
                                        Text { Layout.fillWidth: true; text: card.modelData.title; color: Theme.fg; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 16; font.weight: Font.Bold }
                                        Icon { visible: !!card.modelData.pinned; name: "pin"; size: 13; color: Theme.gold }
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        visible: !!card.modelData.body
                                        text: Util.plain(card.modelData.body)
                                        textFormat: Text.PlainText
                                        color: Theme.fg; opacity: 0.85
                                        wrapMode: Text.Wrap; maximumLineCount: 10; elide: Text.ElideRight
                                        font.family: Theme.sans; font.pixelSize: 14; lineHeight: 1.2
                                    }
                                    RowLayout {
                                        visible: (!!card.c && page.sel === "all") || !!card.modelData.session_date
                                        spacing: 8
                                        Text { visible: !!card.c && page.sel === "all"; text: card.c ? card.c.name : ""; color: card.c ? card.c.color : Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold }
                                        Text { visible: !!card.modelData.session_date; text: card.modelData.session_date ? Util.shortDate(card.modelData.session_date) : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
                                    }
                                }
                                MouseArea { id: cardMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openNote(card.modelData) }
                            }
                        }
                    }
                }
            }

            Text {
                visible: page.shown.length === 0
                Layout.alignment: Qt.AlignHCenter
                text: page.query ? "No notes match." : "Notes you take will show up here."
                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 15
            }
        }
    }
}
