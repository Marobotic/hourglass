import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Talk to Hourglass: the assistant runs on the server and works on this
// account's notes, schedule, alarms and timers through the same tools any AI
// uses. While it works, each tool it uses shows as a line ("Set an alarm");
// when it is done, the app syncs so the change is already here.
Item {
    id: page
    property var app
    property var chat: ({ enabled: true, busy: false, messages: [] })
    property string pending: ""      // sent, not in the list yet
    property bool sending: false
    property bool wasBusy: false

    readonly property bool busy: sending || chat.busy || pending !== ""
    readonly property var messages: {
        const list = (chat.messages || []).slice();
        if (pending !== "" && !list.some(m => m.role === "user" && m.text === pending))
            list.push({ id: "pending", role: "user", text: pending, tools: [] });
        return list;
    }

    function load() {
        Api.request("GET", "/api/assistant", null, (d, err) => {
            // An older background service has no assistant: it needs a restart.
            if (!d && err === "not found") d = { enabled: false, busy: false, messages: [], reason: "Restart Hourglass to use the assistant: its background service is older than this window." };
            if (!d) return;
            page.chat = d;
            if (page.pending !== "" && (d.messages || []).some(m => m.role === "user" && m.text === page.pending)) page.pending = "";
            // Finished: pull what the assistant changed, so every page shows it.
            if (page.wasBusy && !d.busy && page.pending === "") Api.post("/api/sync/now", {});
            page.wasBusy = d.busy || page.pending !== "";
        }, true);
    }

    function sendText(text) {
        const t = text.trim();
        if (!t || page.busy || !page.chat.enabled) return;
        page.pending = t;
        page.sending = true;
        page.wasBusy = true;
        input.text = "";
        Api.request("POST", "/api/assistant/message", { text: t }, (d, err) => {
            page.sending = false;
            if (!d) { page.pending = ""; input.text = t; return; }
            page.load();
        }, true);
    }

    function stop() { Api.request("POST", "/api/assistant/stop", {}, () => page.load(), true); }
    function newChat() {
        Api.request("POST", "/api/assistant/new", {}, () => { page.pending = ""; page.load(); }, true);
    }

    Component.onCompleted: load()
    onVisibleChanged: if (visible) { load(); input.area.forceActiveFocus(); }
    Timer { interval: 900; running: page.visible && page.busy; repeat: true; onTriggered: page.load() }
    Timer { interval: 15000; running: page.visible && !page.busy; repeat: true; onTriggered: page.load() }

    ColumnLayout {
        anchors { fill: parent; margins: 28; topMargin: 24 }
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Section { Layout.fillWidth: true; text: "Assistant"; detail: page.chat.model ? "via opencode" : "" }
            Btn { compact: true; icon: "plus"; text: "New chat"; enabled: page.messages.length > 0 && !page.busy; onClicked: page.newChat() }
        }

        // The conversation
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ListView {
                id: list
                anchors.fill: parent
                visible: page.messages.length > 0
                clip: true
                spacing: 14
                model: page.messages
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                onCountChanged: Qt.callLater(() => list.positionViewAtEnd())
                onContentHeightChanged: if (list.atYEnd || page.busy) Qt.callLater(() => list.positionViewAtEnd())

                delegate: Item {
                    id: row
                    required property var modelData
                    readonly property bool mine: modelData.role === "user"
                    width: list.width
                    height: bubble.height

                    Rectangle {
                        id: bubble
                        anchors.right: row.mine ? parent.right : undefined
                        anchors.left: row.mine ? undefined : parent.left
                        width: Math.min(row.width * (row.mine ? 0.75 : 0.9), body.implicitWidth + 28)
                        height: body.implicitHeight + 22
                        color: row.mine ? Theme.surface2 : "transparent"
                        border.width: row.mine ? 1 : 0
                        border.color: Theme.border
                        Rectangle { visible: !row.mine; width: 3; color: Theme.accent; anchors { left: parent.left; top: parent.top; bottom: parent.bottom } }

                        ColumnLayout {
                            id: body
                            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 11; leftMargin: row.mine ? 14 : 16 }
                            spacing: 6

                            // What the assistant did, one line per tool.
                            Repeater {
                                model: row.mine ? [] : (row.modelData.tools || [])
                                RowLayout {
                                    required property var modelData
                                    spacing: 8
                                    Icon {
                                        name: modelData.status === "completed" ? "check" : modelData.status === "error" ? "close" : "sync"
                                        size: 12
                                        color: modelData.status === "completed" ? Theme.teal : modelData.status === "error" ? Theme.accent : Theme.muted
                                        RotationAnimation on rotation { running: modelData.status !== "completed" && modelData.status !== "error"; from: 0; to: 360; duration: 1200; loops: Animation.Infinite }
                                    }
                                    Text { text: modelData.label; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 13 }
                                }
                            }
                            Text {
                                visible: row.modelData.text !== ""
                                Layout.fillWidth: true
                                Layout.maximumWidth: row.width * (row.mine ? 0.75 : 0.9) - 30
                                text: row.modelData.text
                                textFormat: row.mine ? Text.PlainText : Text.MarkdownText
                                wrapMode: Text.Wrap
                                color: Theme.fg
                                font.family: Theme.mono
                                font.pixelSize: 14
                                lineHeight: 1.15
                                onLinkActivated: link => Qt.openUrlExternally(link)
                            }
                            Text {
                                visible: !!row.modelData.error
                                Layout.fillWidth: true
                                text: row.modelData.error || ""
                                wrapMode: Text.Wrap
                                color: Theme.accent
                                font.family: Theme.mono
                                font.pixelSize: 13
                            }
                        }
                    }
                }

                footer: Item {
                    width: list.width
                    height: page.busy ? 34 : 0
                    visible: page.busy
                    Text {
                        id: dots
                        anchors { left: parent.left; leftMargin: 16; bottom: parent.bottom }
                        property int n: 1
                        text: "Working" + ".".repeat(n)
                        color: Theme.muted
                        font.family: Theme.mono
                        font.pixelSize: 13
                        Timer { interval: 400; running: dots.visible; repeat: true; onTriggered: dots.n = dots.n % 3 + 1 }
                    }
                }
            }

            // Nothing said yet: what it can do, one tap away.
            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent.width, 520)
                visible: page.messages.length === 0
                spacing: 14
                Logo { Layout.alignment: Qt.AlignHCenter; cell: 6 }
                Text {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    text: page.chat.enabled ? "Ask Hourglass to do it for you" : (page.chat.reason || "The assistant is not available.")
                    color: Theme.fg; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 17; font.weight: Font.DemiBold
                }
                Text {
                    visible: page.chat.enabled
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    text: "It can read and change your notes, schedule, alarms, timers and Drive."
                    color: Theme.muted; wrapMode: Text.Wrap
                    font.family: Theme.mono; font.pixelSize: 13
                }
                Flow {
                    visible: page.chat.enabled
                    Layout.fillWidth: true
                    Layout.topMargin: 6
                    spacing: 8
                    Repeater {
                        model: ["What's on today?", "Tidy up my latest note", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "What did I write last lecture?"]
                        Btn { required property string modelData; compact: true; text: modelData; onClicked: page.sendText(modelData) }
                    }
                }
            }
        }

        // The message box
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(Math.max(input.area.contentHeight + 22, 48), 160)
            color: Theme.surface
            border.width: 1
            border.color: input.area.activeFocus ? Theme.accent : Theme.border
            opacity: page.chat.enabled ? 1 : 0.5

            RowLayout {
                anchors { fill: parent; leftMargin: 14; rightMargin: 7; topMargin: 7; bottomMargin: 7 }
                spacing: 10
                ScrollView {
                    id: input
                    property alias text: field.text
                    readonly property alias area: field
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    enabled: page.chat.enabled
                    ScrollBar.vertical.policy: ScrollBar.AsNeeded
                    TextArea {
                        id: field
                        wrapMode: TextArea.Wrap
                        color: Theme.fg
                        placeholderText: page.busy ? "Working on it…" : "Ask Hourglass…   Enter to send, Shift+Enter for a new line"
                        placeholderTextColor: Theme.faint
                        selectionColor: Theme.alpha(Theme.accent, 0.45)
                        selectedTextColor: Theme.fg
                        font.family: Theme.mono
                        font.pixelSize: 14
                        textFormat: TextEdit.PlainText
                        selectByMouse: true
                        topPadding: 6
                        padding: 0
                        background: null
                        Keys.onReturnPressed: event => {
                            if (event.modifiers & Qt.ShiftModifier) { event.accepted = false; return; }
                            page.sendText(field.text);
                        }
                        Keys.onEnterPressed: event => page.sendText(field.text)
                    }
                }
                Btn {
                    Layout.alignment: Qt.AlignBottom
                    kind: page.busy ? "ghost" : "primary"
                    icon: page.busy ? "stop" : "send"
                    text: page.busy ? "Stop" : "Send"
                    enabled: page.chat.enabled && (page.busy || input.text.trim() !== "")
                    onClicked: page.busy ? page.stop() : page.sendText(input.text)
                }
            }
        }
    }
}
