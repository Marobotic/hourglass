import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// An overview, not a dashboard: what is on (or next), the notes that go with
// today, and one line for the next alarm and any running timer.
Item {
    id: page
    property var app
    readonly property var d: app.nowData
    // Today only: what is on and what starts in the next 12 hours. A session
    // marked off is not happening. The first is the card, the rest "coming up".
    property var blocks: []
    readonly property var window: {
        const now = page.app.clock;
        return blocks.filter(b => b.end_ms > now && (b.date === today || b.start_ms - now <= 12 * 3600000));
    }
    readonly property var block: window.length ? window[0] : null
    readonly property var later: window.slice(1)
    readonly property bool live: !!(block && page.app.clock >= block.start_ms && page.app.clock < block.end_ms)
    property var allNotes: []
    readonly property string today: Util.dayOf(app.clock)
    // Notes dated today, then the class's notes: this session's, else the
    // last session's (what to pick up from).
    readonly property var todayNotes: {
        const out = allNotes.filter(n => n.session_date === today);
        const cid = block ? block.course_id : null;
        if (cid) {
            const mine = allNotes.filter(n => n.course_id === cid && n.session_date && n.session_date <= (block.session_date || block.date));
            const last = mine.reduce((m, n) => n.session_date > m ? n.session_date : m, "");
            for (const n of mine) if (n.session_date === last && out.indexOf(n) < 0) out.push(n);
        }
        return out.sort((a, b) => (b.pinned - a.pinned) || (b.updated_at - a.updated_at)).slice(0, 6);
    }
    readonly property var alarm: d && d.alarms.length ? d.alarms[0] : null
    readonly property var timer: d && d.timers.length ? d.timers[0] : null

    function load() {
        const from = Util.dayOf(app.clock);
        Api.get("/api/schedule?from=" + from + "&to=" + Util.addDays(from, 1), r => {
            if (!r) return;
            page.blocks = Util.merge(r.occurrences.filter(o => o.mark !== "off"));
        });
        Api.get("/api/notes", d => { if (d) page.allNotes = d; });
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
                    text: !page.block ? "DAY OFF" : page.live ? "NOW" : page.block.date === (page.d ? page.d.now.date : "") ? "NEXT" : "NEXT · " + Util.shortDate(page.block.date).toUpperCase()
                    color: page.live ? Theme.accent : Theme.muted
                    font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2
                }
                Text {
                    Layout.fillWidth: true
                    text: page.block ? page.block.title : "Heyyy, your day is off!"
                    color: Theme.fg; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 30; font.weight: Font.Bold
                }
                Text {
                    visible: !!page.block
                    text: page.block ? Util.range(page.block.start_time, page.block.end_time) + (page.block.location ? "   " + page.block.location : "") : ""
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.DemiBold
                }
                Text {
                    visible: !page.block && page.app.courses.length > 0
                    text: "Nothing on today or in the next 12 hours."
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
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
                        // This session's note when there is one, so a click never makes a second.
                        onClicked: {
                            const o = page.block.parts[0], day = o.session_date || o.date;
                            page.app.sessionNote(o, page.allNotes.filter(n => n.course_id === o.course_id && n.session_date === day));
                        }
                    }
                    Btn { visible: !page.block && !page.app.courses.length; kind: "primary"; icon: "plus"; text: "Add a course"; onClicked: page.app.editCourse(null) }
                }
            }
        }

        // the rest of today
        ColumnLayout {
            visible: page.later.length > 0
            Layout.fillWidth: true
            Layout.maximumWidth: 760
            spacing: 6
            Text { text: "COMING UP"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2 }
            Repeater {
                model: page.later
                Rectangle {
                    id: lr
                    required property var modelData
                    Layout.fillWidth: true
                    height: 52
                    color: lrMouse.containsMouse ? Theme.surface2 : Theme.surface
                    border.width: 1
                    border.color: Theme.border
                    Rectangle { width: 4; height: parent.height; color: lr.modelData.color }
                    RowLayout {
                        anchors { fill: parent; leftMargin: 18; rightMargin: 14 }
                        spacing: 16
                        Text { text: Util.range(lr.modelData.start_time, lr.modelData.end_time); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold }
                        Text { Layout.fillWidth: true; text: lr.modelData.title; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15 }
                        Text { text: lr.modelData.location || ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                    }
                    MouseArea { id: lrMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(lr.modelData.parts[0]) }
                }
            }
        }

        // notes for today
        ColumnLayout {
            Layout.fillWidth: true
            Layout.maximumWidth: 760
            spacing: 10
            Text { text: "NOTES FOR TODAY"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2 }
            Text {
                visible: page.todayNotes.length === 0
                text: "Nothing yet. Notes you take in class show up here."
                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
            }
            Flow {
                Layout.fillWidth: true
                spacing: 10
                Repeater {
                    model: page.todayNotes
                    Rectangle {
                        id: nc
                        required property var modelData
                        readonly property var c: page.app.courseById(modelData.course_id)
                        width: (parent.width - 10) / 2
                        height: Math.min(ncCol.implicitHeight + 24, 170)
                        clip: true
                        color: c ? Theme.mix(Theme.bg, Qt.color(c.color), ncMouse.containsMouse ? 0.2 : 0.13) : (ncMouse.containsMouse ? Theme.surface2 : Theme.surface)
                        border.width: 1
                        border.color: c ? Theme.alpha(c.color, 0.45) : Theme.border
                        ColumnLayout {
                            id: ncCol
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
                            spacing: 6
                            Text { Layout.fillWidth: true; visible: !!nc.modelData.title; text: nc.modelData.title; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold }
                            Text { Layout.fillWidth: true; visible: !!nc.modelData.body; text: nc.modelData.body; textFormat: Text.PlainText; color: Theme.fg; opacity: 0.85; wrapMode: Text.Wrap; maximumLineCount: 4; elide: Text.ElideRight; font.family: Theme.sans; font.pixelSize: 14 }
                            Text {
                                text: [nc.c ? nc.c.name : "", nc.modelData.session_date === page.today ? "Today" : nc.modelData.session_date ? "Last class · " + Util.shortDate(nc.modelData.session_date) : ""].filter(x => x).join("  ·  ")
                                color: nc.c ? nc.c.color : Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold
                            }
                        }
                        MouseArea { id: ncMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openNote(nc.modelData) }
                    }
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
