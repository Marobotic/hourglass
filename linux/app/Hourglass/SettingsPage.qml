import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Preferences for this computer. The sync server is built in and not editable.
Item {
    id: page
    property var app
    readonly property var s: app.settings || ({})
    readonly property var sync: app.appState.sync || ({})

    function set(patch) { Api.put("/api/settings", patch, () => page.app.pollState()); }

    component SettingRow: RowLayout {
        property string label
        property string hint: ""
        default property alias controls: box.data
        Layout.fillWidth: true
        spacing: 16
        ColumnLayout {
            Layout.preferredWidth: 280
            spacing: 2
            Text { text: parent.parent.label; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 15 }
            Text { visible: parent.parent.hint !== ""; text: parent.parent.hint; color: Theme.muted; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 13 }
        }
        RowLayout { id: box; spacing: 6 }
        Item { Layout.fillWidth: true }
    }

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true
        ColumnLayout {
            width: Math.min(parent.width, 900)
            spacing: 22
            ColumnLayout {
                Layout.fillWidth: true
                Layout.margins: 32
                spacing: 22

                Text { text: "Settings"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }

                Section { Layout.fillWidth: true; text: "Time" }
                SettingRow {
                    label: "Clock"
                    Btn { text: "12-hour"; kind: "subtle"; active: page.s.time_format !== "24h"; onClicked: page.set({ time_format: "12h" }) }
                    Btn { text: "24-hour"; kind: "subtle"; active: page.s.time_format === "24h"; onClicked: page.set({ time_format: "24h" }) }
                }
                SettingRow {
                    label: "Week starts on"
                    Repeater {
                        model: [{ l: "Saturday", v: 6 }, { l: "Sunday", v: 7 }, { l: "Monday", v: 1 }]
                        Btn { required property var modelData; text: modelData.l; kind: "subtle"; active: page.s.week_start === modelData.v; onClicked: page.set({ week_start: modelData.v }) }
                    }
                }

                Section { Layout.fillWidth: true; text: "Alarms" }
                SettingRow {
                    label: "Lecture reminders"
                    hint: "Rings before every lecture, on all your devices."
                    Repeater {
                        model: [0, 10, 15, 30, 60]
                        Btn { required property int modelData; text: modelData ? modelData + " min" : "Off"; kind: "subtle"; active: (page.s.lecture_reminder_min || 0) === modelData; onClicked: page.set({ lecture_reminder_min: modelData }) }
                    }
                }
                SettingRow {
                    label: "Ringtone"
                    hint: "Tap Play to hear it once."
                    Repeater {
                        model: ["classic", "klaxon", "siren", "digital", "rising", "bell"]
                        Btn { required property string modelData; text: modelData.charAt(0).toUpperCase() + modelData.slice(1); kind: "subtle"; active: (page.s.ringtone || "classic") === modelData; onClicked: page.set({ ringtone: modelData }) }
                    }
                    Btn { icon: "play"; text: "Play"; compact: true; onClicked: Api.post("/api/ring/preview?name=" + (page.s.ringtone || "classic"), {}) }
                }
                SettingRow {
                    label: "Alarm sound"
                    hint: "Off: alarms still show a notification."
                    Btn { text: "On"; kind: "subtle"; active: page.s.sound !== false; onClicked: page.set({ sound: true }) }
                    Btn { text: "Off"; kind: "subtle"; active: page.s.sound === false; onClicked: page.set({ sound: false }) }
                }

                Section { Layout.fillWidth: true; text: "Sync" }
                SettingRow {
                    label: page.sync.state === "synced" ? "Synced" : page.sync.state === "offline" ? "Offline" : "Not connected"
                    hint: page.sync.state === "synced" ? "Everything is saved on marobotic.dev and shared with your phones. Last sync " + Util.clock(page.sync.last_ok || Date.now()) + "."
                        : page.sync.state === "offline" ? "Changes are kept on this computer and sent when the connection is back."
                        : "Sign-in token missing from the keyring."
                    Btn { icon: "sync"; text: "Sync now"; onClicked: Api.post("/api/sync/now", {}, () => page.app.pollState()) }
                }
            }
        }
    }
}
