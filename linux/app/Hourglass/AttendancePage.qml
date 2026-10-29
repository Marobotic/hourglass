import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Every subject with every session so far: ✓ attended, ✗ absent, – off (no
// class), empty = not marked yet. Click a box to change it.
Item {
    id: page
    property var app
    property var sessions: [] // [{ course, sessions: [{ date, mark, event_id, future }] }]
    property string last: ""
    readonly property string today: Util.dayOf(app.clock)

    function load() {
        Api.get("/api/events", evs => {
            if (!evs) return;
            const mine = evs.filter(e => e.course_id);
            const starts = mine.map(e => e.start_date).sort();
            if (!starts.length) { page.sessions = []; return; }
            // To the end of term (the last "until"), at most 6 months out.
            const ends = mine.map(e => e.repeat && e.repeat.until ? e.repeat.until : e.start_date).sort();
            const to = [ends[ends.length - 1], Util.addDays(page.today, 183)].sort()[0];
            Api.get("/api/schedule?from=" + starts[0] + "&to=" + (to > page.today ? to : page.today), r => {
                if (!r) return;
                const now = Date.now();
                const by = {};
                for (const o of r.occurrences) {
                    if (!o.course_id) continue;
                    const day = o.session_date || o.date;
                    const c = by[o.course_id] || (by[o.course_id] = {});
                    if (!c[day]) c[day] = { date: day, mark: o.mark || "", event_id: o.event_id, future: o.start_ms > now };
                }
                const next = page.app.courses.map(c => ({ course: c, sessions: Object.values(by[c.id] || {}).sort((a, b) => a.date < b.date ? -1 : 1) }));
                // Only redraw when something changed (it is re-read every few seconds).
                const key = JSON.stringify(next);
                if (key !== page.last) { page.last = key; page.sessions = next; }
            });
        });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { if (page.visible) page.load(); } }
    // Marks made on another page, device or by an AI show up while you look.
    Timer { interval: 4000; running: page.visible && Util.shown(page.app); repeat: true; onTriggered: page.load() }

    // unmarked -> attended -> absent -> off -> unmarked
    function next(m) { return m === "" ? "attended" : m === "attended" ? "absent" : m === "absent" ? "off" : "none"; }
    function mark(course, date, status) { Api.action("mark_session", { course: course.id, date: date, status: status }); }
    function count(list, m) { return list.filter(s => s.mark === m && (m || !s.future)).length; }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 0

            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 40
                spacing: 18

                Text { text: "Attendance"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold }
                RowLayout {
                    spacing: 18
                    component Key: RowLayout {
                        property string box
                        property color tint
                        property string label
                        spacing: 6
                        Rectangle {
                            width: 18; height: 18; color: parent.box ? Theme.alpha(parent.tint, 0.25) : "transparent"; border.width: 1; border.color: parent.box ? parent.tint : Theme.faint
                            Text { anchors.centerIn: parent; text: parent.parent.box; color: parent.parent.tint; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.Bold }
                        }
                        Text { text: parent.label; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                    }
                    Key { box: "✓"; tint: Theme.teal; label: "attended" }
                    Key { box: "✗"; tint: Theme.accent; label: "absent" }
                    Key { box: "–"; tint: Theme.muted; label: "off (no class)" }
                    Key { box: ""; tint: Theme.faint; label: "not marked: click to mark" }
                }
                Text {
                    visible: !page.sessions.length
                    text: "No courses yet."
                    color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
                }

                Repeater {
                    model: page.sessions
                    Card {
                        id: card
                        required property var modelData
                        readonly property var list: modelData.sessions
                        readonly property int past: list.filter(s => !s.future).length
                        readonly property int yes: page.count(list, "attended")
                        readonly property int no: page.count(list, "absent")
                        readonly property int off: page.count(list, "off")
                        readonly property int open: page.count(list, "")
                        Layout.fillWidth: true
                        implicitHeight: col.implicitHeight + 40
                        stripe: modelData.course.color
                        ColumnLayout {
                            id: col
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 20; leftMargin: 24 }
                            spacing: 12
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 12
                                Text { Layout.fillWidth: true; text: card.modelData.course.name; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 18; font.weight: Font.Bold }
                                Text {
                                    text: card.yes + card.no ? Math.round(100 * card.yes / (card.yes + card.no)) + "%" : "—"
                                    color: card.yes + card.no && card.yes / (card.yes + card.no) < 0.75 ? Theme.accent : Theme.teal
                                    font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.Bold
                                }
                            }
                            Text {
                                text: "✓ " + card.yes + " attended   ✗ " + card.no + " absent   – " + card.off + " off" + (card.open ? "   · " + card.open + " not marked" : "") + "   of " + card.past + " so far, " + (card.list.length - card.past) + " to come"
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Flow {
                                Layout.fillWidth: true
                                spacing: 8
                                Repeater {
                                    model: card.list
                                    ColumnLayout {
                                        id: cell
                                        required property var modelData
                                        readonly property color tint: modelData.mark === "attended" ? Theme.teal : modelData.mark === "absent" ? Theme.accent : modelData.mark === "off" ? Theme.muted : Theme.faint
                                        spacing: 3
                                        opacity: modelData.future && !modelData.mark ? 0.35 : 1
                                        Rectangle {
                                            Layout.alignment: Qt.AlignHCenter
                                            width: 34; height: 34
                                            color: cell.modelData.mark ? Theme.alpha(cell.tint, cm.containsMouse ? 0.4 : 0.25) : (cm.containsMouse ? Theme.surface2 : "transparent")
                                            border.width: 1
                                            border.color: cell.modelData.mark ? cell.tint : Theme.faint
                                            Text {
                                                anchors.centerIn: parent
                                                text: cell.modelData.mark === "attended" ? "✓" : cell.modelData.mark === "absent" ? "✗" : cell.modelData.mark === "off" ? "–" : ""
                                                color: cell.tint; font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.Bold
                                            }
                                            MouseArea {
                                                id: cm
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                onClicked: page.mark(card.modelData.course, cell.modelData.date, page.next(cell.modelData.mark))
                                            }
                                            ToolTip.visible: cm.containsMouse
                                            ToolTip.text: Util.longDate(cell.modelData.date)
                                        }
                                        Text {
                                            Layout.alignment: Qt.AlignHCenter
                                            text: Util.shortDate(cell.modelData.date).split(" ").slice(1).join(" ")
                                            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10
                                        }
                                    }
                                }
                            }
                            Btn {
                                visible: card.open > 0
                                compact: true; kind: "subtle"; icon: "check"
                                text: "Mark the " + card.open + " unmarked as attended"
                                onClicked: { for (const s of card.list) if (!s.mark && !s.future) page.mark(card.modelData.course, s.date, "attended"); }
                            }
                        }
                    }
                }
            }
        }
    }
}
