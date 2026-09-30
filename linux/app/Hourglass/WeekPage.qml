import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: page
    property var app
    readonly property string today: app.nowData ? app.nowData.now.date : Util.dayOf(Date.now())
    property string ws: ""
    property var occ: []
    readonly property int gutter: 52
    readonly property int hourH: 66
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
                Text { text: page.ws ? Util.monthName(page.ws) + " " + new Date(Util.parse(page.ws)).getUTCFullYear() : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                Text { text: page.ws ? Util.dayNum(page.ws) + " – " + Util.shortDate(Util.addDays(page.ws, 6)).slice(4) : ""; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }
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
                        Text { Layout.alignment: Qt.AlignHCenter; text: Util.weekdays[index].toUpperCase(); color: parent.parent.isToday ? Theme.accent : Theme.muted; font.family: Theme.mono; font.pixelSize: 13; font.letterSpacing: 1.2; font.weight: Font.DemiBold }
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
                        Text { x: 0; y: -7; width: page.gutter - 12; horizontalAlignment: Text.AlignRight; text: Util.pad(page.startHour + index) + ":00"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
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
                                id: block
                                required property var modelData
                                readonly property var o: modelData.o
                                readonly property bool past: page.app.clock > o.end_ms
                                readonly property string room: (o.location || "").split(" · ")[0]
                                readonly property string lead: (o.teacher || "").split(",")[0].replace(/^(Ms|Mr|Dr|Prof)\.\s*/, "")
                                x: 3 + modelData.lane * (col.width - 6) / modelData.lanes
                                width: (col.width - 6) / modelData.lanes - 3
                                y: (modelData.s - page.startHour * 60) / 60 * page.hourH + 1
                                height: Math.max(26, (modelData.e - modelData.s) / 60 * page.hourH - 3)
                                radius: 5
                                // opaque tint: text stays full contrast on any wallpaper-free background
                                color: Theme.mix(Theme.surface, Qt.color(o.color), blockMouse.containsMouse ? 0.3 : 0.2)
                                border.color: Theme.alpha(o.color, 0.7)
                                opacity: past ? 0.72 : 1
                                clip: true
                                Rectangle { width: 4; height: parent.height; color: block.o.color; radius: 2 }
                                ColumnLayout {
                                    anchors { fill: parent; leftMargin: 10; rightMargin: 6; topMargin: 5 }
                                    spacing: 2
                                    Text {
                                        Layout.fillWidth: true; text: block.o.title; color: Theme.fg
                                        wrapMode: Text.Wrap; maximumLineCount: block.height > 120 ? 2 : 1; elide: Text.ElideRight
                                        font.family: Theme.mono; font.pixelSize: 14; font.weight: Font.Bold
                                    }
                                    // room first: it is the part you need at a glance
                                    Text {
                                        Layout.fillWidth: true; visible: block.height > 40
                                        text: (block.room ? "<b>" + block.room + "</b>  " : "") + block.o.start_time + "–" + block.o.end_time
                                        textFormat: Text.StyledText
                                        color: Theme.fg; opacity: 0.9; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                    }
                                    Text {
                                        Layout.fillWidth: true; visible: block.height > 64
                                        text: Util.kindLabel(block.o.kind) + (block.o.course_code ? " · " + block.o.course_code : "")
                                        color: Theme.fg; opacity: 0.7; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                    }
                                    Text {
                                        Layout.fillWidth: true; visible: block.height > 88 && block.lead !== ""
                                        text: block.lead
                                        color: Theme.fg; opacity: 0.7; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                    }
                                    Item { Layout.fillHeight: true }
                                }
                                MouseArea { id: blockMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.app.openSession(block.o) }
                            }
                        }

                        // now line
                        Rectangle {
                            readonly property real mins: Util.minutesOf(page.app.clock)
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
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
        }
    }
}
