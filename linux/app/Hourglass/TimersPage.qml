import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Timers: the one that ends first, big in the middle; the others below it;
// saved timers to start again; a quick way to start or schedule a new one.
// A timer rings and notifies on every device when it ends.
Item {
    id: page
    property var app
    property var timers: []
    property string focusId: ""
    property bool keep: false

    function load() { Api.action("list_timers", {}, d => { if (d) page.timers = d; }); }
    function act(t, action) { Api.action("update_timer", { timer_id: t.id, action: action }); }
    function start(minutes) {
        const args = { minutes: minutes, label: label.text, persistent: page.keep };
        if (Util.isTime(at.text)) args.at = Util.parseTime(at.text);
        Api.action("start_timer", args, () => { label.text = ""; mins.text = ""; at.text = ""; });
    }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 5000; running: page.visible; repeat: true; onTriggered: page.load() }

    function remain(t) {
        if (t.state === "running") return Math.max(0, Math.ceil((t.ends_at - Math.max(app.clock, t.start_at || 0)) / 1000));
        return t.state === "idle" ? t.duration_s : (t.remaining_s || 0);
    }
    readonly property var active: timers.filter(t => t.state === "running" || t.state === "paused")
        .sort((a, b) => (a.state === "paused") - (b.state === "paused") || (a.ends_at || 0) - (b.ends_at || 0))
    readonly property var saved: timers.filter(t => t.state === "idle")
    readonly property var hero: active.find(t => t.id === focusId) || active[0] || null
    readonly property bool heroWaiting: !!hero && hero.state === "running" && (hero.start_at || 0) > app.clock

    ScrollView {
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: parent.width
            spacing: 0

            ColumnLayout {
                Layout.fillWidth: true
                Layout.maximumWidth: 860
                Layout.alignment: Qt.AlignHCenter
                Layout.margins: 32
                spacing: 22

                Text { text: "Timers"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }

                // the big one
                Card {
                    Layout.fillWidth: true
                    implicitHeight: heroCol.implicitHeight + 64
                    stripe: page.hero ? (page.hero.state === "paused" ? Theme.gold : Theme.accent) : Theme.border
                    ColumnLayout {
                        id: heroCol
                        anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 28; rightMargin: 28 }
                        spacing: 10
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: !page.hero ? "NO TIMER RUNNING" : page.heroWaiting ? "STARTS AT " + Util.clock(page.hero.start_at).toUpperCase() : page.hero.state === "paused" ? "PAUSED" : "RUNNING"
                            color: page.hero && page.hero.state === "running" && !page.heroWaiting ? Theme.accent : Theme.muted
                            font.family: Theme.mono; font.pixelSize: 13; font.weight: Font.Bold; font.letterSpacing: 2
                        }
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: Util.countdown(page.hero ? page.remain(page.hero) : 0)
                            color: page.hero && page.hero.state === "running" ? Theme.fg : Theme.muted
                            font.family: Theme.mono; font.pixelSize: 96; font.weight: Font.Bold
                        }
                        Text { Layout.alignment: Qt.AlignHCenter; visible: !!page.hero; text: page.hero ? page.hero.label : ""; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 16 }
                        Rectangle {
                            visible: !!page.hero
                            Layout.fillWidth: true
                            Layout.topMargin: 6
                            height: 6; color: Theme.surface2
                            Rectangle {
                                height: 6; color: page.hero && page.hero.state === "paused" ? Theme.gold : Theme.accent
                                width: page.hero && page.hero.duration_s ? parent.width * page.remain(page.hero) / page.hero.duration_s : 0
                                Behavior on width { NumberAnimation { duration: 900 } }
                            }
                        }
                        RowLayout {
                            visible: !!page.hero
                            Layout.alignment: Qt.AlignHCenter
                            Layout.topMargin: 8
                            spacing: 8
                            Btn {
                                kind: "primary"
                                icon: page.hero && page.hero.state === "running" ? "pause" : "play"
                                text: page.hero && page.hero.state === "running" ? "Pause" : "Resume"
                                onClicked: page.act(page.hero, page.hero.state === "running" ? "pause" : "resume")
                            }
                            Btn { text: "+1 min"; onClicked: page.act(page.hero, "add_minute") }
                            Btn { icon: "sync"; text: "Restart"; onClicked: page.act(page.hero, "restart") }
                            Btn { icon: "close"; text: page.hero && page.hero.persistent ? "Reset" : "Stop"; kind: "subtle"; onClicked: page.act(page.hero, "reset") }
                        }
                        Text {
                            visible: !page.hero
                            Layout.alignment: Qt.AlignHCenter
                            text: "Start one below, or ask an AI: “set a 30 minute timer”."
                            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 14
                        }
                    }
                }

                // the others
                ColumnLayout {
                    visible: page.active.length > 1
                    Layout.fillWidth: true
                    spacing: 0
                    Section { Layout.fillWidth: true; text: "Also running" }
                    Repeater {
                        model: page.active.filter(t => !page.hero || t.id !== page.hero.id)
                        Rectangle {
                            id: other
                            required property var modelData
                            Layout.fillWidth: true
                            height: 54
                            color: otherMouse.containsMouse ? Theme.surface : "transparent"
                            Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                            MouseArea { id: otherMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: page.focusId = other.modelData.id }
                            RowLayout {
                                anchors { fill: parent; leftMargin: 8; rightMargin: 4 }
                                spacing: 14
                                Text { Layout.preferredWidth: 130; text: Util.countdown(page.remain(other.modelData)); color: other.modelData.state === "paused" ? Theme.muted : Theme.fg; font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.Bold }
                                Text { Layout.fillWidth: true; text: other.modelData.label + ((other.modelData.start_at || 0) > page.app.clock ? "  ·  starts " + Util.clock(other.modelData.start_at) : other.modelData.state === "paused" ? "  ·  paused" : ""); color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                                Btn { compact: true; kind: "subtle"; icon: other.modelData.state === "running" ? "pause" : "play"; onClicked: page.act(other.modelData, other.modelData.state === "running" ? "pause" : "resume") }
                                Btn { compact: true; kind: "subtle"; icon: "close"; onClicked: page.act(other.modelData, "reset") }
                            }
                        }
                    }
                }

                // new timer
                Section { Layout.fillWidth: true; text: "New timer" }
                Flow {
                    Layout.fillWidth: true
                    spacing: 8
                    Repeater {
                        model: [1, 5, 10, 15, 20, 25, 30, 45, 60, 90]
                        Btn { required property int modelData; text: modelData < 60 ? modelData + " min" : Math.floor(modelData / 60) + " h" + (modelData % 60 ? " " + (modelData % 60) : ""); onClicked: page.start(modelData) }
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8
                    Field {
                        id: mins
                        Layout.preferredWidth: 110
                        placeholderText: "Minutes"
                        validator: DoubleValidator { bottom: 0.1; top: 1440 }
                        onAccepted: if (acceptableInput) page.start(Number(text))
                    }
                    Field { id: label; Layout.fillWidth: true; placeholderText: "Label (optional)" }
                    Field { id: at; Layout.preferredWidth: 130; placeholderText: "Start at (opt.)"; invalid: text !== "" && !Util.isTime(text) }
                    Btn { kind: "primary"; icon: "play"; text: Util.isTime(at.text) ? "Schedule" : "Start"; enabled: mins.acceptableInput && (at.text === "" || Util.isTime(at.text)); onClicked: page.start(Number(mins.text)) }
                }
                RowLayout {
                    spacing: 10
                    Rectangle {
                        width: 16; height: 16
                        color: page.keep ? Theme.accent : "transparent"
                        border.width: 1; border.color: page.keep ? Theme.accent : Theme.faint
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.keep = !page.keep }
                    }
                    Text {
                        text: "Keep it as a saved timer to use again"
                        color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: page.keep = !page.keep }
                    }
                }

                // saved timers
                ColumnLayout {
                    visible: page.saved.length > 0
                    Layout.fillWidth: true
                    spacing: 0
                    Section { Layout.fillWidth: true; text: "Saved timers" }
                    Repeater {
                        model: page.saved
                        Rectangle {
                            id: sv
                            required property var modelData
                            Layout.fillWidth: true
                            height: 54
                            color: "transparent"
                            Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                            RowLayout {
                                anchors { fill: parent; leftMargin: 8; rightMargin: 4 }
                                spacing: 14
                                Text { Layout.preferredWidth: 130; text: Util.countdown(sv.modelData.duration_s); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 22; font.weight: Font.Bold }
                                Text { Layout.fillWidth: true; text: sv.modelData.label; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                                Btn { compact: true; kind: "primary"; icon: "play"; text: "Start"; onClicked: { page.focusId = sv.modelData.id; page.act(sv.modelData, "start"); } }
                                Btn { compact: true; kind: "subtle"; icon: "trash"; onClicked: page.app.confirm("Delete " + sv.modelData.label + "?", "The saved timer is removed from every device.", "Delete", () => page.act(sv.modelData, "stop")) }
                            }
                        }
                    }
                }
            }
        }
    }
}
