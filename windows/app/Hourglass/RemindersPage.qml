import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Reminders: "call mom at 6". Not alarms: at its time a reminder shows a
// notification and, if chosen, a short tone (the sidecar does that); then it
// waits as overdue until it is ticked, like a to-do. Its own settings are at
// the bottom of this page and sync to every device.
Item {
    id: page
    property var app
    property var reminders: []
    property var settings: ({ style: "tone", tone: "chime", snooze_min: 10, tones: ["chime", "ding", "pop", "harp"] })
    property bool showDone: false
    property string editing: "" // the reminder being edited in the form, or ""

    property bool repeats: false
    property var newDays: [1, 2, 3, 4, 5]

    readonly property var open: reminders.filter(r => !r.done)
    readonly property var done: reminders.filter(r => r.done).slice(0, 20)

    function load() {
        Api.action("list_reminders", {}, d => { if (d) page.reminders = d; });
        Api.action("reminder_settings", {}, d => { if (d) page.settings = d; });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: page.load() }

    function whenText(r) {
        const repeat = !r.days || !r.days.length ? "" : r.days.length === 7 ? "Every day" : r.days.join() === "1,2,3,4,5" ? "Weekdays" : r.days.join() === "6,7" ? "Weekends" : r.days.map(d => Util.weekdays[d - 1]).join(", ");
        if (r.done) return "Done" + (r.time ? "  ·  " + Util.t(r.time) : "");
        const at = r.due_at || r.occurrence;
        let day = "";
        if (at) {
            const d = Util.dayOf(at), today = Util.dayOf(page.app.clock);
            day = d === today ? "today" : d === Util.addDays(today, 1) ? "tomorrow" : d === Util.addDays(today, -1) ? "yesterday" : Util.shortDate(d);
        }
        const parts = [(at ? Util.clock(at) : Util.t(r.time)) + (day ? " " + day : "")];
        if (repeat) parts.push(repeat);
        if (r.snooze_at && r.snooze_at > page.app.clock) parts.push("snoozed");
        else if (r.overdue) parts.push("overdue");
        return parts.join("  ·  ");
    }

    function startEdit(r) {
        page.editing = r.id;
        what.text = r.label;
        timeField.text = Util.t(r.time);
        page.repeats = !!(r.days && r.days.length);
        page.newDays = page.repeats ? r.days : [1, 2, 3, 4, 5];
        dateField.text = r.date || "";
        what.forceActiveFocus();
    }
    function clearForm() {
        page.editing = ""; what.text = ""; timeField.text = ""; dateField.text = ""; page.repeats = false; page.newDays = [1, 2, 3, 4, 5];
    }
    function save() {
        const args = { label: what.text.trim(), time: Util.parseTime(timeField.text) };
        if (page.repeats) args.days = page.newDays;
        else if (Util.isDate(dateField.text)) args.date = dateField.text;
        else if (page.editing) {
            // A time alone: today, or tomorrow once it has passed.
            const today = Util.dayOf(page.app.clock);
            args.date = Util.minutes(timeField.text) > Util.minutesOf(page.app.clock) ? today : Util.addDays(today, 1);
        }
        if (page.editing) Api.action("update_reminder", Object.assign({ reminder_id: page.editing }, args), () => page.load());
        else Api.action("add_reminder", args, () => page.load());
        clearForm();
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

                Text { text: "Reminders"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }

                // New / edit
                Card {
                    Layout.fillWidth: true
                    implicitHeight: form.implicitHeight + 32
                    ColumnLayout {
                        id: form
                        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 16 }
                        spacing: 12
                        Field { id: what; Layout.fillWidth: true; placeholderText: "Remind me to…"; onAccepted: if (saveBtn.enabled) page.save() }
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 10
                            Field { id: timeField; Layout.preferredWidth: 120; placeholderText: "6:00 PM"; invalid: text !== "" && !Util.isTime(text) }
                            Btn { compact: true; text: "Once"; active: !page.repeats; kind: "subtle"; onClicked: page.repeats = false }
                            Btn { compact: true; text: "Repeats"; active: page.repeats; kind: "subtle"; onClicked: page.repeats = true }
                            Field { id: dateField; visible: !page.repeats; Layout.preferredWidth: 150; placeholderText: "YYYY-MM-DD"; invalid: text !== "" && !Util.isDate(text) }
                            DayToggles { visible: page.repeats; days: page.newDays; onToggled: d => page.newDays = d }
                            Item { Layout.fillWidth: true }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Text {
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: page.repeats ? "Shows on the highlighted days; tick it done each time." : dateField.text === "" ? "No day: today, or tomorrow if that time has passed." : "Shows once, then waits until you tick it done."
                                color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
                            }
                            Btn { visible: page.editing !== ""; kind: "subtle"; text: "Cancel"; onClicked: page.clearForm() }
                            Btn {
                                id: saveBtn
                                kind: "primary"; icon: "reminder"; text: page.editing ? "Save" : "Add reminder"
                                enabled: what.text.trim() !== "" && Util.isTime(timeField.text) && (page.repeats ? page.newDays.length > 0 : (dateField.text === "" || Util.isDate(dateField.text)))
                                onClicked: page.save()
                            }
                        }
                    }
                }

                Text {
                    visible: page.open.length === 0
                    text: "No reminders. Add one above, or ask the assistant: \"remind me to call mom at 6\"."
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
                    Layout.fillWidth: true; wrapMode: Text.WordWrap
                }

                Repeater {
                    model: page.open
                    delegate: reminderRow
                }

                RowLayout {
                    visible: page.done.length > 0
                    Layout.fillWidth: true
                    Section { Layout.fillWidth: true; text: "Done"; detail: "" + page.done.length }
                    Btn { compact: true; kind: "subtle"; text: page.showDone ? "Hide" : "Show"; onClicked: page.showDone = !page.showDone }
                }
                Repeater {
                    model: page.showDone ? page.done : []
                    delegate: reminderRow
                }

                // Their own settings, separate from alarms; synced.
                Section { Layout.fillWidth: true; Layout.topMargin: 10; text: "Reminder settings" }
                Text { Layout.fillWidth: true; wrapMode: Text.WordWrap; text: "A reminder is a notification with Done and Snooze, not an alarm. These settings are the same on all your devices."; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13 }
                RowLayout {
                    spacing: 6
                    Text { text: "Alert"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14; Layout.preferredWidth: 90 }
                    Btn { compact: true; kind: "subtle"; text: "With a tone"; active: page.settings.style === "tone"; onClicked: Api.action("set_reminder_settings", { style: "tone" }, () => page.load()) }
                    Btn { compact: true; kind: "subtle"; text: "Notification only"; active: page.settings.style === "silent"; onClicked: Api.action("set_reminder_settings", { style: "silent" }, () => page.load()) }
                }
                RowLayout {
                    visible: page.settings.style === "tone"
                    spacing: 6
                    Text { text: "Tone"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14; Layout.preferredWidth: 90 }
                    Repeater {
                        model: page.settings.tones || []
                        Btn {
                            required property string modelData
                            compact: true; kind: "subtle"; icon: "play"
                            text: modelData.charAt(0).toUpperCase() + modelData.slice(1)
                            active: page.settings.tone === modelData
                            tip: "Choose and hear it"
                            onClicked: {
                                Api.post("/api/ring/preview?reminder=1&name=" + modelData, {});
                                Api.action("set_reminder_settings", { tone: modelData }, () => page.load());
                            }
                        }
                    }
                }
                RowLayout {
                    spacing: 6
                    Text { text: "Snooze"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14; Layout.preferredWidth: 90 }
                    Repeater {
                        model: [5, 10, 15, 30, 60]
                        Btn {
                            required property int modelData
                            compact: true; kind: "subtle"
                            text: modelData === 60 ? "1 hour" : modelData + " min"
                            active: page.settings.snooze_min === modelData
                            onClicked: Api.action("set_reminder_settings", { snooze_min: modelData }, () => page.load())
                        }
                    }
                }
                Item { Layout.preferredHeight: 20 }
            }
        }
    }

    Component {
        id: reminderRow
        Card {
            id: row
            required property var modelData
            Layout.fillWidth: true
            implicitHeight: 70
            opacity: modelData.done ? 0.55 : 1
            Behavior on opacity { NumberAnimation { duration: 160 } }
            Lively { key: "reminder:" + row.modelData.id; sig: [row.modelData.label, row.modelData.time, row.modelData.date || "", JSON.stringify(row.modelData.days || []), row.modelData.done, row.modelData.snooze_at || 0].join("|") }
            // Overdue: a red edge, like a session that has started.
            Rectangle { visible: row.modelData.overdue; width: 4; anchors { left: parent.left; top: parent.top; bottom: parent.bottom } color: Theme.accent }
            RowLayout {
                anchors { fill: parent; leftMargin: 14; rightMargin: 12 }
                spacing: 14
                // Tick: done / not done.
                Rectangle {
                    width: 24; height: 24; radius: 12
                    color: row.modelData.done ? Theme.teal : "transparent"
                    border.color: row.modelData.done ? Theme.teal : Theme.muted; border.width: 2
                    Text { anchors.centerIn: parent; visible: row.modelData.done; text: "✓"; color: Theme.bg; font.pixelSize: 14; font.weight: Font.Bold }
                    MouseArea {
                        anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            if (!row.modelData.done) Motion.burstAt(parent, 12, 12);
                            Api.action("update_reminder", { reminder_id: row.modelData.id, action: row.modelData.done ? "undone" : "done" }, () => page.load());
                        }
                    }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 3
                    Text { Layout.fillWidth: true; text: row.modelData.label; color: Theme.fg; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 15; font.weight: row.modelData.done ? Font.Normal : Font.Bold; font.strikeout: row.modelData.done }
                    Text { Layout.fillWidth: true; text: page.whenText(row.modelData); color: row.modelData.overdue ? Theme.accent : Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13 }
                }
                Btn { visible: row.modelData.overdue; icon: "timer"; kind: "subtle"; tip: "Snooze " + page.settings.snooze_min + " min"; onClicked: Api.action("update_reminder", { reminder_id: row.modelData.id, action: "snooze" }, () => page.load()) }
                Btn { visible: !row.modelData.done; icon: "edit"; kind: "subtle"; tip: "Change"; onClicked: page.startEdit(row.modelData) }
                Btn { icon: "trash"; kind: "subtle"; tip: "Delete"; onClicked: Api.action("remove_reminder", { reminder_id: row.modelData.id }, () => page.load()) }
            }
        }
    }
}
