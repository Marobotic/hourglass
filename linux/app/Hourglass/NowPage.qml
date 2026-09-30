import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// An overview, not a dashboard: what is on (or next), the few things after it,
// and one line for the next alarm and any running timer.
Item {
    id: page
    property var app
    readonly property var d: app.nowData
    // Merged blocks for the next week; the first one not yet over is the card.
    property var blocks: []
    readonly property var block: {
        const now = page.app.clock;
        return blocks.find(b => b.end_ms > now) || null;
    }
    readonly property bool live: !!(block && page.app.clock >= block.start_ms && page.app.clock < block.end_ms)
    readonly property var upcoming: block ? blocks.filter(b => b.start_ms > block.start_ms).slice(0, 3) : []
    readonly property var alarm: d && d.alarms.length ? d.alarms[0] : null
    readonly property var timer: d && d.timers.length ? d.timers[0] : null

    function load() {
        const from = Util.dayOf(app.clock);
        Api.get("/api/schedule?from=" + from + "&to=" + Util.addDays(from, 6), r => {
            if (!r) return;
            page.blocks = Util.merge(r.occurrences);
        });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 60000; running: page.visible; repeat: true; onTriggered: page.load() }

    ColumnLayout {
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 40 }
        spacing: 28

        // date and time
        ColumnLayout {
            spacing: 0
            Text { text: page.d ? Util.longDate(page.d.now.date) : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
            Text { text: Util.clock(page.app.clock); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 44; font.weight: Font.Bold }
        }

        // the one thing that matters
        Card {
            Layout.fillWidth: true
            Layout.maximumWidth: 760
            implicitHeight: heroCol.implicitHeight + 48
            stripe: page.block ? page.block.color : Theme.border
            ColumnLayout {
                id: heroCol
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 24; leftMargin: 28 }
                spacing: 10
                Text {
                    text: !page.block ? "NOTHING SCHEDULED" : page.live ? "NOW" : page.block.date === (page.d ? page.d.now.date : "") ? "NEXT" : "NEXT · " + Util.shortDate(page.block.date).toUpperCase()
                    color: page.live ? Theme.accent : Theme.muted
                    font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2
                }
                Text {
                    Layout.fillWidth: true
                    text: page.block ? page.block.title : "Your week is clear."
                    color: Theme.fg; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 30; font.weight: Font.Bold
                }
                Text {
                    visible: !!page.block
                    text: page.block ? Util.range(page.block.start_time, page.block.end_time) + (page.block.location ? "   " + page.block.location : "") : ""
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.DemiBold
                }
                Text {
                    visible: !!(page.block && page.block.teacher)
                    text: page.block ? Util.lead(page.block.teacher) : ""
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
                }
                Text {
                    visible: !!page.block
                    text: !page.block ? "" : page.live ? Util.left(Math.ceil((page.block.end_ms - page.app.clock) / 60000)) : "Starts " + Util.relative(Math.ceil((page.block.start_ms - page.app.clock) / 60000))
                    color: page.live ? Theme.accent : Theme.muted; font.family: Theme.mono; font.pixelSize: 15
                }
                RowLayout {
                    Layout.topMargin: 6
                    spacing: 8
                    Btn {
                        visible: !!(page.block && page.block.course_id)
                        kind: "primary"; icon: "note"; text: "Notes for this class"
                        onClicked: page.app.sessionNote(page.block.parts[0], page.live && page.d ? page.d.notes.session : [])
                    }
                    Btn { visible: !page.block && !page.app.courses.length; kind: "primary"; icon: "plus"; text: "Add a course"; onClicked: page.app.editCourse(null) }
                }
            }
        }

        // after that
        ColumnLayout {
            visible: page.upcoming.length > 0
            Layout.fillWidth: true
            Layout.maximumWidth: 760
            spacing: 0
            Text { text: "AFTER THAT"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2; bottomPadding: 8 }
            Repeater {
                model: page.upcoming
                Rectangle {
                    required property var modelData
                    Layout.fillWidth: true
                    height: 52
                    color: rowMouse.containsMouse ? Theme.surface : "transparent"
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                    RowLayout {
                        anchors { fill: parent; leftMargin: 4; rightMargin: 4 }
                        spacing: 16
                        Rectangle { width: 4; height: 22; color: modelData.color }
                        Text { Layout.preferredWidth: 130; text: (modelData.date === (page.d ? page.d.now.date : "") ? "" : Util.weekdayOf(modelData.date) + " ") + Util.t(modelData.start_time); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold }
                        Text { Layout.fillWidth: true; text: modelData.title; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15 }
                        Text { text: modelData.location || ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                    }
                    MouseArea { id: rowMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(modelData.parts[0]) }
                }
            }
        }

        // one line for alarms and timers
        RowLayout {
            visible: !!(page.alarm || page.timer)
            spacing: 28
            RowLayout {
                visible: !!page.alarm
                spacing: 8
                Icon { name: "bell"; size: 15; color: Theme.muted }
                Text { text: page.alarm ? Util.clock(page.alarm.next_at) + (Util.dayOf(page.alarm.next_at) === (page.d ? page.d.now.date : "") ? "" : " " + Util.weekdayOf(Util.dayOf(page.alarm.next_at))) : ""; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold }
                Text { text: page.alarm ? page.alarm.label : ""; color: Theme.muted; elide: Text.ElideRight; Layout.maximumWidth: 380; font.family: Theme.mono; font.pixelSize: 15 }
            }
            RowLayout {
                visible: !!page.timer
                spacing: 8
                Icon { name: "timer"; size: 15; color: Theme.accent }
                Text {
                    text: page.timer ? Util.countdown(page.timer.state === "running" ? (page.timer.ends_at - page.app.clock) / 1000 : page.timer.remaining_s) + "  " + page.timer.label : ""
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15
                }
            }
        }
    }
}
