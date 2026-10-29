import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Cities side by side. The home clock is the app's time zone on every device.
Item {
    id: page
    property var app
    property var clocks: []
    property var hits: []
    readonly property var home: clocks.find(c => c.home) || null
    readonly property string homeDate: Util.dayOf(app.clock)

    function load() { Api.action("world_clock", {}, d => { if (d) page.clocks = d; }); }
    function search(q) {
        if (!q.trim()) { hits = []; return; }
        Api.get("/api/timezones?q=" + encodeURIComponent(q), d => { if (d) page.hits = d.slice(0, 10); });
    }
    function addZone(zone) { Api.action("add_clock", { zone: zone }, () => { q.text = ""; page.hits = []; }); }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 30000; running: page.visible && Util.shown(page.app); repeat: true; onTriggered: page.load() }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true
        ColumnLayout {
            width: parent.width
            spacing: 24
            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 40
                spacing: 24

                RowLayout {
                    Layout.fillWidth: true
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: "World clock"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold }
                        Text { text: page.home ? "Hourglass runs on " + page.home.label + " time" : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15 }
                    }
                    Item { Layout.fillWidth: true }
                    Field {
                        id: q
                        Layout.preferredWidth: 340
                        placeholderText: "Add a city, e.g. Tokyo"
                        onTextChanged: t.restart()
                        Keys.onEscapePressed: text = ""
                        onAccepted: if (page.hits.length) page.addZone(page.hits[0].zone)
                        Timer { id: t; interval: 200; onTriggered: page.search(q.text) }

                        // Matches drop down under the field.
                        Popup {
                            y: q.height
                            width: q.width
                            padding: 0
                            visible: q.activeFocus && q.text !== "" && page.hits.length > 0
                            closePolicy: Popup.NoAutoClose
                            background: Rectangle { color: Theme.surface; border.width: 1; border.color: Theme.faint }
                            contentItem: Column {
                                Repeater {
                                    model: page.hits
                                    Rectangle {
                                        required property var modelData
                                        required property int index
                                        width: q.width
                                        height: 44
                                        color: hitMouse.containsMouse ? Theme.surface2 : "transparent"
                                        Rectangle { visible: index > 0; width: parent.width; height: 1; color: Theme.border }
                                        RowLayout {
                                            anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
                                            spacing: 10
                                            Text { text: modelData.city; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14 }
                                            Text { Layout.fillWidth: true; text: modelData.zone.split("/")[0].replace("_", " "); color: Theme.faint; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 12 }
                                            Text { text: Util.clockAt(page.app.clock, modelData.offset_min); color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                                        }
                                        MouseArea { id: hitMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.addZone(modelData.zone) }
                                    }
                                }
                            }
                        }
                    }
                }

                Flow {
                    Layout.fillWidth: true
                    spacing: 12
                    Repeater {
                        model: page.clocks
                        Card {
                            id: card
                            required property var modelData
                            readonly property string date: Util.dateAt(page.app.clock, modelData.offset_min)
                            width: 300
                            height: 170
                            stripe: modelData.home ? Theme.accent : "transparent"
                            Lively { key: "clock:" + (card.modelData.id || card.modelData.zone || card.modelData.label); sig: card.modelData.label + "|" + card.modelData.offset_min }
                            ColumnLayout {
                                anchors { fill: parent; margins: 18; leftMargin: 22 }
                                spacing: 4
                                RowLayout {
                                    Layout.fillWidth: true
                                    Text { Layout.fillWidth: true; text: modelData.label; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.Bold }
                                    Chip { visible: modelData.home; text: "App time"; tint: Theme.accent }
                                    Btn { visible: !modelData.home; icon: "close"; kind: "subtle"; compact: true; onClicked: Api.action("remove_clock", { clock_id: modelData.id }) }
                                }
                                Text { text: Util.clockAt(page.app.clock, modelData.offset_min); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 38; font.weight: Font.Bold }
                                Text {
                                    text: (card.date === page.homeDate ? "Today" : card.date > page.homeDate ? "Tomorrow" : "Yesterday") + (modelData.home ? "" : "  ·  " + Util.diffText(modelData.diff_min))
                                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
                                }
                                Item { Layout.fillHeight: true }
                                Btn {
                                    visible: !modelData.home
                                    compact: true; kind: "subtle"; text: "Use as app time"
                                    onClicked: Api.action("set_home_zone", { clock_id: modelData.id }, () => page.app.pollState())
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
