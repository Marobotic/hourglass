import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: page
    property var app
    readonly property string today: app.nowData ? app.nowData.now.date : Util.fmt(Date.now())
    property string ws: ""
    property var occ: []
    readonly property int gutter: 52
    readonly property int hourH: 58
    readonly property int startHour: {
        let m = 8;
        for (const o of occ) m = Math.min(m, Math.floor(Util.minutes(o.start_time) / 60));
        return Math.max(0, m);
    }
    readonly property int endHour: {
        let m = 18;
        for (const o of occ) m = Math.max(m, Math.ceil(Util.minutes(o.end_time) / 60));
        return Math.min(24, m);
    }

    function load() {
        if (!ws) ws = Util.weekStart(today);
        Api.get("/api/schedule?from=" + ws + "&to=" + Util.addDays(ws, 6), d => { if (d) page.occ = d.occurrences; });
    }
    onWsChanged: load()
    Component.onCompleted: load()
    Connections { target: Api; function onChanged() { page.load(); } }
    onVisibleChanged: if (visible) load()

    // Side-by-side lanes for overlapping sessions on one day.
    function layoutDay(date) {
        const list = occ.filter(o => o.date === date).map(o => ({ o: o, s: Util.minutes(o.start_time), e: Math.max(Util.minutes(o.end_time), Util.minutes(o.start_time) + 30) }));
        list.sort((a, b) => a.s - b.s);
        const lanesEnd = [];
        for (const it of list) {
            let lane = lanesEnd.findIndex(end => end <= it.s);
            if (lane < 0) { lane = lanesEnd.length; lanesEnd.push(0); }
            lanesEnd[lane] = it.e;
            it.lane = lane;
        }
        for (const it of list) it.lanes = lanesEnd.length;
        return list;
    }

    ColumnLayout {
        anchors { fill: parent; margins: 32; bottomMargin: 20 }
        spacing: 18

        RowLayout {
            Layout.fillWidth: true
            spacing: 8
            ColumnLayout {
                spacing: 2
                Text { text: page.ws ? Util.monthName(page.ws) + " " + new Date(Util.parse(page.ws)).getUTCFullYear() : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                Text { text: page.ws ? Util.dayNum(page.ws) + " – " + Util.short(Util.addDays(page.ws, 6)).slice(4) : ""; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }
            }
            Item { Layout.fillWidth: true }
            Btn { icon: "left"; onClicked: page.ws = Util.addDays(page.ws, -7) }
            Btn { text: "This week"; active: page.ws === Util.weekStart(page.today); onClicked: page.ws = Util.weekStart(page.today) }
            Btn { icon: "right"; onClicked: page.ws = Util.addDays(page.ws, 7) }
            Item { width: 8 }
            Btn { kind: "primary"; icon: "plus"; text: "Event"; onClicked: page.app.editEvent(null) }
        }

        // Day headers
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
                    height: 44
                    ColumnLayout {
                        anchors.centerIn: parent
                        spacing: 0
                        Text { Layout.alignment: Qt.AlignHCenter; text: Util.weekdays[index].toUpperCase(); color: parent.parent.isToday ? Theme.accent : Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.letterSpacing: 1.2; font.weight: Font.DemiBold }
                        Rectangle {
                            Layout.alignment: Qt.AlignHCenter
                            width: 30; height: 26; radius: 5
                            color: parent.parent.isToday ? Theme.accent : "transparent"
                            Text { anchors.centerIn: parent; text: parent.parent.parent.date ? Util.dayNum(parent.parent.parent.date) : ""; color: parent.parent.parent.isToday ? Theme.accentInk : Theme.fg; font.family: Theme.mono; font.pixelSize: 15; font.weight: Font.DemiBold }
                        }
                    }
                }
            }
        }

        // Grid
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
                readonly property int headroom: 10 // room for the first hour label

                // hour lines + labels
                Repeater {
                    model: page.endHour - page.startHour + 1
                    Item {
                        required property int index
                        y: grid.headroom + index * page.hourH
                        width: grid.width
                        Text { x: 0; y: -7; width: page.gutter - 12; horizontalAlignment: Text.AlignRight; text: Util.pad(page.startHour + index) + ":00"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11 }
                        Rectangle { x: page.gutter; width: grid.width - page.gutter; height: 1; color: Theme.border; opacity: 0.7 }
                    }
                }

                // day columns
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

                        Rectangle { anchors.fill: parent; color: col.isToday ? Theme.alpha(Theme.accent, 0.04) : "transparent" }
                        Rectangle { width: 1; height: parent.height; color: Theme.border; opacity: 0.7 }

                        // click empty space: add an event at that hour
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onDoubleClicked: mouse => {
                                const h = page.startHour + Math.floor(mouse.y / page.hourH);
                                page.app.editEvent(null, { date: col.date, start: Util.pad(h) + ":00", end: Util.pad(Math.min(23, h + 1)) + ":00" });
                            }
                        }

                        Repeater {
                            model: col.date ? page.layoutDay(col.date) : []
                            Rectangle {
                                required property var modelData
                                readonly property var o: modelData.o
                                readonly property bool past: page.app.clock > o.end_ms
                                x: 3 + modelData.lane * (col.width - 6) / modelData.lanes
                                width: (col.width - 6) / modelData.lanes - 3
                                y: (modelData.s - page.startHour * 60) / 60 * page.hourH + 1
                                height: Math.max(24, (modelData.e - modelData.s) / 60 * page.hourH - 3)
                                radius: 5
                                color: blockMouse.containsMouse ? Theme.alpha(o.color, 0.32) : Theme.alpha(o.color, 0.2)
                                border.color: Theme.alpha(o.color, 0.55)
                                opacity: past ? 0.55 : 1
                                clip: true
                                Rectangle { width: 3; height: parent.height; color: parent.o.color; radius: 2 }
                                ColumnLayout {
                                    anchors { fill: parent; leftMargin: 9; rightMargin: 5; topMargin: 5 }
                                    spacing: 1
                                    Text { Layout.fillWidth: true; text: parent.parent.o.title; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12; font.weight: Font.DemiBold }
                                    Text { Layout.fillWidth: true; visible: parent.parent.height > 38; text: parent.parent.o.start_time + "–" + parent.parent.o.end_time; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 10 }
                                    Text { Layout.fillWidth: true; visible: parent.parent.height > 56 && !!parent.parent.o.location; text: parent.parent.o.location || ""; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 10 }
                                    Item { Layout.fillHeight: true }
                                }
                                MouseArea { id: blockMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(parent.o) }
                            }
                        }

                        // now line
                        Rectangle {
                            readonly property real mins: { const d = new Date(page.app.clock); return d.getHours() * 60 + d.getMinutes(); }
                            visible: col.isToday && mins >= page.startHour * 60 && mins <= page.endHour * 60
                            y: (mins - page.startHour * 60) / 60 * page.hourH
                            width: col.width
                            height: 2
                            color: Theme.accent
                            z: 5
                            Rectangle { width: 8; height: 8; radius: 4; color: Theme.accent; x: -4; y: -3 }
                        }
                    }
                }
            }
        }

        Text {
            text: "Double-click an empty slot to add an event there."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 11
        }
    }
}
