import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Week grid or month overview. Back-to-back sessions of one course are one card.
Item {
    id: page
    property var app
    property string mode: app.scheduleMode // week | month
    readonly property string today: app.nowData ? app.nowData.now.date : Util.dayOf(Date.now())
    property string anchor: today // any date inside the shown week or month
    property var occ: []
    readonly property int gutter: 88
    readonly property int hourH: 72

    // week range
    readonly property string ws: anchor ? Util.weekStart(anchor) : ""
    // month range: whole weeks covering the month
    readonly property string monthFirst: anchor ? anchor.slice(0, 8) + "01" : ""
    readonly property string gridStart: monthFirst ? Util.weekStart(monthFirst) : ""
    readonly property int gridWeeks: {
        if (!monthFirst) return 5;
        const p = monthFirst.split("-");
        const last = Util.fmt(Date.UTC(+p[0], +p[1], 0));
        return Math.ceil((Util.daysBetween(gridStart, last) + 1) / 7);
    }
    readonly property string from: mode === "week" ? ws : gridStart
    readonly property string to: mode === "week" ? Util.addDays(ws, 6) : Util.addDays(gridStart, gridWeeks * 7 - 1)

    readonly property var merged: Util.merge(occ)
    function dayItems(d) { return merged.filter(o => o.date === d); }

    readonly property int startHour: {
        let m = 8;
        for (const o of merged) m = Math.min(m, Math.floor(Util.minutes(o.start_time) / 60));
        return Math.max(0, m);
    }
    readonly property int endHour: {
        let m = 17;
        for (const o of merged) m = Math.max(m, Math.ceil(Util.minutes(o.end_time) / 60));
        return Math.min(24, m);
    }

    function load() {
        if (!from || !to) return;
        Api.get("/api/schedule?from=" + from + "&to=" + to, d => { if (d) page.occ = d.occurrences; });
    }
    onFromChanged: load()
    onToChanged: load()
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    function shift(n) {
        anchor = mode === "week" ? Util.addDays(ws, 7 * n) : Util.fmt(Date.UTC(+monthFirst.slice(0, 4), +monthFirst.slice(5, 7) - 1 + n, 1));
    }

    ColumnLayout {
        anchors { fill: parent; margins: 32; bottomMargin: 16 }
        spacing: 16

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            ColumnLayout {
                spacing: 2
                Text {
                    text: page.mode === "week" ? Util.shortDate(page.ws) + " – " + Util.shortDate(Util.addDays(page.ws, 6)) : ""
                    visible: text !== ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
                }
                Text {
                    text: page.anchor ? Util.monthName(page.mode === "week" ? page.ws : page.monthFirst) + " " + page.anchor.slice(0, 4) : ""
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold
                }
            }
            Item { Layout.fillWidth: true }
            Btn { text: "Week"; kind: "subtle"; active: page.mode === "week"; onClicked: page.mode = "week" }
            Btn { text: "Month"; kind: "subtle"; active: page.mode === "month"; onClicked: page.mode = "month" }
            Item { width: 12 }
            Btn { icon: "left"; onClicked: page.shift(-1) }
            Btn { text: "Today"; onClicked: page.anchor = page.today }
            Btn { icon: "right"; onClicked: page.shift(1) }
            Item { width: 12 }
            Btn { kind: "primary"; icon: "plus"; text: "Event"; onClicked: page.app.editEvent(null) }
        }

        // ------------------------------------------------------------- week
        ColumnLayout {
            visible: page.mode === "week"
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: page.gutter
                spacing: 0
                Repeater {
                    model: 7
                    Item {
                        required property int index
                        readonly property string date: page.ws ? Util.addDays(page.ws, index) : ""
                        readonly property bool isToday: date === page.today
                        Layout.fillWidth: true
                        Layout.preferredWidth: 1
                        height: 50
                        ColumnLayout {
                            anchors.centerIn: parent
                            spacing: 2
                            Text { Layout.alignment: Qt.AlignHCenter; text: parent.parent.date ? Util.weekdayOf(parent.parent.date).toUpperCase() : ""; color: parent.parent.isToday ? Theme.accent : Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.DemiBold; font.letterSpacing: 1 }
                            Text { Layout.alignment: Qt.AlignHCenter; text: parent.parent.date ? Util.dayNum(parent.parent.date) : ""; color: parent.parent.isToday ? Theme.accent : Theme.fg; font.family: Theme.mono; font.pixelSize: 18; font.weight: Font.Bold }
                        }
                        Rectangle { visible: parent.isToday; anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 6; rightMargin: 6 } height: 2; color: Theme.accent }
                    }
                }
            }

            ScrollView {
                id: sv
                Layout.fillWidth: true
                Layout.fillHeight: true
                contentWidth: availableWidth
                clip: true

                Item {
                    id: grid
                    width: sv.availableWidth
                    height: (page.endHour - page.startHour) * page.hourH + headroom + 12
                    readonly property real colW: (width - page.gutter) / 7
                    readonly property int headroom: 12

                    Repeater {
                        model: page.endHour - page.startHour + 1
                        Item {
                            required property int index
                            y: grid.headroom + index * page.hourH
                            width: grid.width
                            Text { x: 0; y: -9; width: page.gutter - 12; horizontalAlignment: Text.AlignRight; text: Util.t(Util.pad(page.startHour + index) + ":00"); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                            Rectangle { x: page.gutter; width: grid.width - page.gutter; height: 1; color: Theme.border }
                        }
                    }

                    Repeater {
                        model: 7
                        Item {
                            id: col
                            required property int index
                            readonly property string date: page.ws ? Util.addDays(page.ws, index) : ""
                            readonly property bool isToday: date === page.today
                            x: page.gutter + index * grid.colW
                            y: grid.headroom
                            width: grid.colW
                            height: grid.height - grid.headroom
                            Rectangle { width: 1; height: parent.height; color: Theme.border }

                            MouseArea {
                                anchors.fill: parent
                                onDoubleClicked: mouse => {
                                    const h = page.startHour + Math.floor(mouse.y / page.hourH);
                                    page.app.editEvent(null, { date: col.date, start: Util.pad(h) + ":00", end: Util.pad(Math.min(23, h + 1)) + ":00" });
                                }
                            }

                            Repeater {
                                model: col.date ? page.dayItems(col.date) : []
                                Rectangle {
                                    id: card
                                    required property var modelData
                                    readonly property var o: modelData
                                    readonly property bool past: page.app.clock > o.end_ms
                                    readonly property int s: Util.minutes(o.start_time)
                                    readonly property int e: Math.max(Util.minutes(o.end_time), s + 30)
                                    x: 4
                                    width: col.width - 8
                                    y: (s - page.startHour * 60) / 60 * page.hourH + 1
                                    height: (e - s) / 60 * page.hourH - 2
                                    z: 2
                                    // solid: nothing behind shows through
                                    color: Theme.mix(Theme.bg, Qt.color(o.color), hover.containsMouse ? 0.34 : 0.24)
                                    border.width: 1
                                    border.color: o.color
                                    clip: true
                                    Rectangle { width: 4; height: parent.height; color: card.o.color }
                                    ColumnLayout {
                                        anchors { fill: parent; leftMargin: 12; rightMargin: 8; topMargin: 7 }
                                        spacing: 3
                                        Text {
                                            Layout.fillWidth: true; text: card.o.title
                                            color: Theme.fg
                                            wrapMode: Text.Wrap; maximumLineCount: card.height > 150 ? 2 : 1; elide: Text.ElideRight
                                            font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.Bold
                                        }
                                        Text {
                                            Layout.fillWidth: true; visible: card.height > 44
                                            text: Util.range(card.o.start_time, card.o.end_time)
                                            color: Theme.fg; wrapMode: Text.Wrap; maximumLineCount: card.height > 110 ? 2 : 1; elide: Text.ElideRight
                                            font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold
                                        }
                                        Text {
                                            Layout.fillWidth: true; visible: card.height > 70 && !!card.o.location
                                            text: card.o.location || ""
                                            color: Theme.fg; elide: Text.ElideRight
                                            font.family: Theme.mono; font.pixelSize: 16; font.weight: Font.Bold
                                        }
                                        Text {
                                            Layout.fillWidth: true; visible: card.height > 96 && !!card.o.teacher
                                            text: Util.lead(card.o.teacher)
                                            color: Theme.fg; opacity: 0.8; wrapMode: Text.Wrap; maximumLineCount: 2; elide: Text.ElideRight
                                            font.family: Theme.mono; font.pixelSize: 14
                                        }
                                        Text {
                                            Layout.fillWidth: true; visible: card.height > 150 && card.o.parts.length > 1
                                            text: Util.partsText(card.o)
                                            color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 13
                                        }
                                        Item { Layout.fillHeight: true }
                                    }
                                    MouseArea { id: hover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(card.o.parts[0]) }
                                }
                            }

                            Rectangle {
                                readonly property real mins: Util.minutesOf(page.app.clock)
                                visible: col.isToday && mins >= page.startHour * 60 && mins <= page.endHour * 60
                                y: (mins - page.startHour * 60) / 60 * page.hourH
                                width: col.width
                                height: 2
                                color: Theme.accent
                                z: 5
                            }
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------- month
        ColumnLayout {
            visible: page.mode === "month"
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            RowLayout {
                Layout.fillWidth: true
                spacing: 0
                Repeater {
                    model: 7
                    Text {
                        required property int index
                        Layout.fillWidth: true
                        Layout.preferredWidth: 1
                        horizontalAlignment: Text.AlignHCenter
                        bottomPadding: 8
                        text: page.gridStart ? Util.weekdayOf(Util.addDays(page.gridStart, index)).toUpperCase() : ""
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.DemiBold; font.letterSpacing: 1
                    }
                }
            }

            GridLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                columns: 7
                rowSpacing: 0
                columnSpacing: 0
                Repeater {
                    model: page.gridWeeks * 7
                    Rectangle {
                        id: cell
                        required property int index
                        readonly property string date: page.gridStart ? Util.addDays(page.gridStart, index) : ""
                        readonly property bool inMonth: date.slice(0, 7) === page.monthFirst.slice(0, 7)
                        readonly property bool isToday: date === page.today
                        readonly property var items: date ? page.dayItems(date) : []
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        Layout.preferredWidth: 1
                        Layout.preferredHeight: 1
                        color: cellHover.containsMouse ? Theme.surface : "transparent"
                        border.width: 1
                        border.color: Theme.border
                        ColumnLayout {
                            anchors { fill: parent; margins: 8 }
                            spacing: 4
                            Text {
                                text: cell.date ? Util.dayNum(cell.date) : ""
                                color: cell.isToday ? Theme.accent : cell.inMonth ? Theme.fg : Theme.faint
                                font.family: Theme.mono; font.pixelSize: 15; font.weight: cell.isToday ? Font.Bold : Font.Normal
                            }
                            Repeater {
                                model: cell.items.slice(0, 3)
                                RowLayout {
                                    required property var modelData
                                    Layout.fillWidth: true
                                    Layout.preferredHeight: 22
                                    spacing: 6
                                    opacity: cell.inMonth ? 1 : 0.5
                                    Rectangle { width: 4; height: 18; color: modelData.color }
                                    Text {
                                        Layout.fillWidth: true
                                        text: Util.t(modelData.start_time) + " " + (modelData.course_code || modelData.title)
                                        color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                    }
                                }
                            }
                            Text {
                                visible: cell.items.length > 3
                                text: "+" + (cell.items.length - 3) + " more"
                                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
                            }
                            Item { Layout.fillHeight: true }
                        }
                        MouseArea {
                            id: cellHover
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: { page.anchor = cell.date; page.mode = "week"; }
                        }
                    }
                }
            }
        }
    }
}
