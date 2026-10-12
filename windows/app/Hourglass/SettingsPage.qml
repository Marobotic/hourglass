import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Dialogs

// Preferences. The account is the Jukebox one; ringtones and the
// chosen one sync to every device.
Item {
    id: page
    property var app
    readonly property var s: app.settings || ({})
    readonly property var sync: app.appState.sync || ({})
    property var account: ({})
    property var tones: []
    property bool busy: false
    property var ai: null // { key, mcp_url } once made
    property string aiNote: ""
    property string testNote: ""
    function aiLoad(make) {
        Api.request(make ? "POST" : "GET", "/api/ai", make ? {} : null, (d, err) => { if (d) page.ai = d; page.aiNote = err || ""; }, true);
    }
    // QML has no clipboard API: copy through a hidden text field.
    TextEdit { id: clip; visible: false }
    function copy(text) { clip.text = text; clip.selectAll(); clip.copy(); page.aiNote = "Copied."; }

    function set(patch) { Api.put("/api/settings", patch, () => { page.app.pollState(); page.load(); }); }
    function load() {
        Api.get("/api/account", d => { if (d) page.account = d; });
        Api.get("/api/ringtones", d => { if (d) page.tones = d; });
    }
    Component.onCompleted: { load(); aiLoad(false); }
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: page.load() }

    FileDialog {
        id: picker
        title: "Choose an audio file"
        nameFilters: ["Audio (*.mp3 *.m4a *.aac *.wav *.ogg *.opus *.flac)", "All files (*)"]
        onAccepted: {
            page.busy = true;
            Api.request("POST", "/api/ringtones/upload", { path: selectedFile.toString() }, (d, err) => { page.busy = false; page.app.pollState(); }, false);
        }
    }

    // A setting: its name and hint, then its buttons. Beside each other when
    // there is room; in a narrow window the buttons go under the name.
    component SettingRow: GridLayout {
        id: row
        property string label
        property string hint: ""
        default property alias controls: box.data
        readonly property bool stacked: page.width < 860
        Layout.fillWidth: true
        columns: stacked ? 1 : 3
        columnSpacing: 16
        rowSpacing: 8
        ColumnLayout {
            Layout.preferredWidth: row.stacked ? -1 : 280
            Layout.fillWidth: row.stacked
            spacing: 2
            Text { text: row.label; color: Theme.fg; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 15 }
            Text { visible: row.hint !== ""; text: row.hint; color: Theme.muted; wrapMode: Text.Wrap; Layout.fillWidth: true; font.family: Theme.mono; font.pixelSize: 13 }
        }
        RowLayout { id: box; spacing: 6 }
        Item { visible: !row.stacked; Layout.fillWidth: true }
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
                    hint: "Rings on every device. Upload an MP3 or pick a song in Jukebox: Set as alarm."
                    Btn { icon: "folder-open"; text: page.busy ? "Uploading…" : "Upload audio file"; enabled: !page.busy && !!page.account.signed_in; onClicked: picker.open() }
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    Repeater {
                        model: page.tones
                        Rectangle {
                            id: tone
                            required property var modelData
                            Layout.fillWidth: true
                            height: 48
                            color: modelData.selected ? Theme.surface2 : toneMouse.containsMouse ? Theme.surface : "transparent"
                            border.width: modelData.selected ? 1 : 0
                            border.color: Theme.faint
                            Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border; visible: !tone.modelData.selected }
                            MouseArea { id: toneMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.set({ ringtone: tone.modelData.id }) }
                            RowLayout {
                                anchors { fill: parent; leftMargin: 14; rightMargin: 8 }
                                spacing: 12
                                Rectangle {
                                    width: 14; height: 14
                                    color: tone.modelData.selected ? Theme.accent : "transparent"
                                    border.width: 1; border.color: tone.modelData.selected ? Theme.accent : Theme.faint
                                }
                                Text { text: tone.modelData.name; color: Theme.fg; elide: Text.ElideRight; Layout.maximumWidth: 360; font.family: Theme.mono; font.pixelSize: 15; font.weight: tone.modelData.selected ? Font.Bold : Font.Normal }
                                Text {
                                    Layout.fillWidth: true
                                    text: tone.modelData.kind === "builtin" ? "Built in" : (tone.modelData.kind === "song" ? "Song" + (tone.modelData.artist ? " · " + tone.modelData.artist : "") : "Upload") + (tone.modelData.ready === false ? " · downloading" : "")
                                    color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 13
                                }
                                Btn { icon: "play"; compact: true; kind: "subtle"; enabled: tone.modelData.ready !== false; onClicked: Api.request("POST", "/api/ring/preview?name=" + tone.modelData.id, {}, null, true) }
                                Btn {
                                    visible: tone.modelData.kind !== "builtin"
                                    icon: "trash"; compact: true; kind: "subtle"
                                    onClicked: page.app.confirm("Delete " + tone.modelData.name + "?", "It is removed from every device." + (tone.modelData.selected ? " Alarms go back to Classic." : ""), "Delete", () => Api.del("/api/ringtones/" + tone.modelData.id))
                                }
                            }
                        }
                    }
                }
                SettingRow {
                    label: "Alarm sound"
                    hint: "Off: alarms still show a notification."
                    Btn { text: "On"; kind: "subtle"; active: page.s.sound !== false; onClicked: page.set({ sound: true }) }
                    Btn { text: "Off"; kind: "subtle"; active: page.s.sound === false; onClicked: page.set({ sound: false }) }
                }
                SettingRow {
                    label: "Test alarm"
                    hint: page.testNote || "Rings right now like a real alarm: the notification, your ringtone and the alarm screen. It plays even with the sound off."
                    Btn {
                        icon: "volume"; text: "Test alarm"
                        onClicked: Api.request("POST", "/api/ring/test", {}, (d, err) => {
                            // An older background service has no test: it needs a restart.
                            page.testNote = d ? "" : err === "not found" ? "Restart Hourglass to test alarms: its background service is older than this window." : err;
                            page.app.pollState();
                        }, true)
                    }
                }

                Section { Layout.fillWidth: true; text: "Use with AI" }
                Text {
                    Layout.fillWidth: true
                    wrapMode: Text.Wrap
                    text: "Tell any AI \"use Hourglass to move my Tuesday lecture\". Add your link as a connector (MCP server) in ChatGPT, Claude, Gemini CLI or Codex. Anyone with the link can change your schedule, so keep it to yourself."
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13
                }
                // Wraps onto more lines in a narrow window.
                Flow {
                    Layout.fillWidth: true
                    spacing: 8
                    Text {
                        visible: !!(page.ai && page.ai.mcp_url)
                        text: page.ai && page.ai.mcp_url ? page.ai.mcp_url.split("/mcp/")[0] + "/mcp/" + page.ai.mcp_url.split("/mcp/")[1].slice(0, 8) + "…" : ""
                        color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14
                    }
                    Btn { visible: !!(page.ai && page.ai.mcp_url); kind: "primary"; text: "Copy link"; onClicked: page.copy(page.ai.mcp_url) }
                    Btn {
                        visible: !!(page.account && page.account.signed_in)
                        text: page.ai && page.ai.mcp_url ? "New link" : "Make my AI link"
                        onClicked: page.ai && page.ai.mcp_url
                            ? page.app.confirm("Make a new link?", "The old link stops working; AIs using it need the new one.", "New link", () => page.aiLoad(true))
                            : page.aiLoad(true)
                    }
                    Btn {
                        visible: !!(page.ai && page.ai.mcp_url)
                        kind: "danger"; icon: "trash"; text: "Delete link"
                        onClicked: page.app.confirm("Delete the AI link?", "AIs using it lose access at once. You can make a new link any time.", "Delete",
                            () => Api.request("DELETE", "/api/ai", null, (d, err) => { if (d) { page.ai = d; page.aiNote = "Link deleted."; } else page.aiNote = err || ""; }, true))
                    }
                    Text { visible: text !== ""; text: page.aiNote; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                }

                Section { Layout.fillWidth: true; text: "Account" }
                SettingRow {
                    visible: !!page.account.signed_in
                    label: page.account.email || ""
                    hint: "Your Jukebox account. " + (page.sync.state === "synced" ? "Synced " + Util.clock(page.sync.last_ok || page.app.clock) + ", shared with your phones."
                        : page.sync.state === "offline" ? "Offline: changes are kept here and sent when the connection is back." : "")
                    Btn { icon: "sync"; text: "Sync now"; onClicked: Api.post("/api/sync/now", {}, () => page.app.pollState()) }
                    Btn { text: "Sign out"; kind: "subtle"; onClicked: page.app.confirm("Sign out?", "This computer stops syncing until you sign in again.", "Sign out", () => Api.post("/api/account/logout", {}, () => page.app.pollState())) }
                }
            }
        }
    }
}
