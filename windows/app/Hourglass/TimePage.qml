import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: page
    property var app
    property var alarms: []
    property var timers: []
    property var clocks: []
    property var zoneHits: []

    function load() {
        Api.action("list_alarms", {}, d => { if (d) page.alarms = d; });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: page.load() }
    function searchZones(q) {
        if (!q.trim()) { zoneHits = []; return; }
        Api.get("/api/timezones?q=" + encodeURIComponent(q), d => { if (d) page.zoneHits = d.slice(0, 8); });
    }
    readonly property string homeDate: Util.dayOf(app.clock)

    // new-alarm form state
    property string mode: "time" // time | before
    property var newDays: [1, 2, 3, 4, 5]

    function alarmSubtitle(a) {
        if (a.lead_course_id || a.lead_event_id) return "Rings " + a.lead_minutes + " min before the lecture";
        if (a.date) return "Once, " + Util.shortDate(a.date);
        if (!a.days || !a.days.length) return "Every day";
        if (a.days.length === 5 && a.days.every(d => d <= 5)) return "Weekdays";
        return a.days.map(d => Util.weekdays[d - 1]).join(", ");
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: Math.min(parent.width, 820)
            spacing: 18

            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 32
                spacing: 18

                Text { text: "Alarms"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }

                // New alarm
                Card {
                    Layout.fillWidth: true
                    implicitHeight: form.implicitHeight + 32
                    ColumnLayout {
                        id: form
                        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                        spacing: 12
                        RowLayout {
                            spacing: 6
                            Btn { compact: true; text: "At a time"; active: page.mode === "time"; kind: "subtle"; onClicked: page.mode = "time" }
                            Btn { compact: true; text: "Before a course"; active: page.mode === "before"; kind: "subtle"; enabled: page.app.courses.length > 0; onClicked: page.mode = "before" }
                        }
                        RowLayout {
                            visible: page.mode === "time"
                            Layout.fillWidth: true
                            spacing: 10
                            Field { id: timeField; Layout.preferredWidth: 120; placeholderText: "7:30 AM"; invalid: text !== "" && !Util.isTime(text) }
                            DayToggles { days: page.newDays; onToggled: d => page.newDays = d }
                            Field { id: alarmLabel; Layout.fillWidth: true; placeholderText: "Label" }
                        }
                        RowLayout {
                            visible: page.mode === "before"
                            Layout.fillWidth: true
                            spacing: 10
                            Field { id: leadField; Layout.preferredWidth: 70; text: "15"; validator: IntValidator { bottom: 0; top: 600 } }
                            Text { text: "min before every session of"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
                            Picker { id: coursePick; Layout.fillWidth: true; options: page.app.courseOptions(false); value: page.app.courses.length ? page.app.courses[0].id : null }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Text { Layout.fillWidth: true; text: page.mode === "time" ? (page.newDays.length ? "Repeats on the highlighted days." : "No days selected: rings once, at the next matching time.") : "Rings on this computer and your phone once synced."; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
                            Btn {
                                kind: "primary"; icon: "bell"; text: "Add alarm"
                                enabled: page.mode === "time" ? Util.isTime(timeField.text) : (coursePick.value !== null && leadField.acceptableInput)
                                onClicked: {
                                    if (page.mode === "time") {
                                        const args = { time: Util.parseTime(timeField.text), days: page.newDays, label: alarmLabel.text };
                                        if (!page.newDays.length) {
                                            const today = Util.dayOf(page.app.clock);
                                            args.date = Util.minutes(timeField.text) > Util.minutesOf(page.app.clock) ? today : Util.addDays(today, 1);
                                        }
                                        Api.action("set_alarm", args);
                                        timeField.text = ""; alarmLabel.text = "";
                                    } else {
                                        Api.action("set_alarm", { before: coursePick.value, minutes_before: Number(leadField.text) });
                                    }
                                }
                            }
                        }
                    }
                }

                Repeater {
                    model: page.alarms
                    Card {
                        id: alarmCard
                        required property var modelData
                        Layout.fillWidth: true
                        implicitHeight: 74
                        opacity: modelData.enabled ? 1 : 0.55
                        Behavior on opacity { NumberAnimation { duration: 160 } }
                        Lively { key: "alarm:" + modelData.id; sig: [modelData.time, modelData.label, modelData.enabled, JSON.stringify(modelData.days || []), modelData.date || ""].join("|") }
                        RowLayout {
                            anchors { fill: parent; leftMargin: 18; rightMargin: 12 }
                            spacing: 16
                            Text {
                                text: modelData.time ? Util.t(modelData.time) : modelData.next_at ? Util.clock(modelData.next_at) : "—"
                                color: Theme.fg; font.family: Theme.mono; font.pixelSize: 28; font.weight: Font.Bold
                                Layout.preferredWidth: 150
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 3
                                Text { Layout.fillWidth: true; text: modelData.label; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15 }
                                Text {
                                    Layout.fillWidth: true
                                    text: page.alarmSubtitle(modelData) + (modelData.next_at ? "  ·  next " + Util.shortDate(Util.dayOf(modelData.next_at)) + " " + Util.clock(modelData.next_at) : "")
                                    color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                }
                            }
                            // enable toggle
                            Rectangle {
                                width: 40; height: 22; radius: 0
                                color: modelData.enabled ? Theme.accent : Theme.surface2
                                border.color: Theme.border
                                Rectangle { width: 16; height: 16; radius: 0; y: 3; x: modelData.enabled ? 21 : 3; color: modelData.enabled ? Theme.accentInk : Theme.muted; Behavior on x { NumberAnimation { duration: 120 } } }
                                MouseArea {
                                    anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (!modelData.enabled) Motion.burstAt(parent, 31, 11);
                                        Api.put("/api/alarms/" + modelData.id, { enabled: !modelData.enabled });
                                    }
                                }
                            }
                            Btn { icon: "trash"; kind: "subtle"; onClicked: Api.action("remove_alarm", { alarm_id: modelData.id }) }
                        }
                    }
                }
                Item { Layout.preferredHeight: 20 }
            }
        }
    }
}
