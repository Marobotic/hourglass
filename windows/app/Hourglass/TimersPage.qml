import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// One big number with Start / Stop. Tap the number to change the length;
// + schedules a timer for later, listed under the buttons. Every device
// rings when a timer ends.
Item {
    id: page
    property var app
    property var timers: []
    property int length: 25 // minutes the next Start runs for

    function load() { Api.action("list_timers", {}, d => { if (d) page.timers = d; }); }
    Component.onCompleted: load()
    onVisibleChanged: if (visible) load()
    Connections { target: Api; function onChanged() { page.load(); } }
    Timer { interval: 5000; running: page.visible && Util.shown(page.app); repeat: true; onTriggered: page.load() }

    readonly property var current: timers.filter(t => (t.state === "running" && !((t.start_at || 0) > app.clock)) || t.state === "paused")
        .sort((a, b) => (a.ends_at || 0) - (b.ends_at || 0))[0] || null
    readonly property var upcoming: timers.filter(t => t.state === "running" && (t.start_at || 0) > app.clock)
        .sort((a, b) => a.start_at - b.start_at)
    readonly property int secs: current
        ? (current.state === "running" ? Math.max(0, Math.ceil((current.ends_at - app.clock) / 1000)) : current.remaining_s || 0)
        : length * 60

    ColumnLayout {
        anchors { top: parent.top; horizontalCenter: parent.horizontalCenter; topMargin: 60 }
        width: Math.min(parent.width - 64, 560)
        spacing: 18

        Text {
            Layout.alignment: Qt.AlignHCenter
            text: page.current ? page.current.label : "Tap the time to change it"
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 15
        }
        Text {
            Layout.alignment: Qt.AlignHCenter
            id: countdown
            text: Util.countdown(page.secs)
            color: page.current ? Theme.fg : Theme.muted
            font.family: Theme.mono; font.pixelSize: 120; font.weight: Font.Bold
            // Running: every second gives a small beat.
            onTextChanged: if (page.current && page.current.state === "running") beat.restart()
            transformOrigin: Item.Center
            SequentialAnimation {
                id: beat
                NumberAnimation { target: countdown; property: "scale"; to: 1.025; duration: 90; easing.type: Easing.OutQuad }
                NumberAnimation { target: countdown; property: "scale"; to: 1; duration: 260; easing.type: Easing.OutBack }
            }
            MouseArea {
                anchors.fill: parent
                enabled: !page.current
                cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: dialog.ask(false)
            }
        }
        RowLayout {
            Layout.alignment: Qt.AlignHCenter
            spacing: 10
            Btn {
                id: startBtn
                Layout.preferredWidth: 200
                kind: "primary"
                icon: page.current ? "stop" : "play"
                text: page.current ? "Stop timer" : "Start timer"
                onClicked: {
                    if (page.current) Api.action("update_timer", { timer_id: page.current.id, action: "stop" });
                    else { Motion.burstAt(startBtn, startBtn.width / 2, startBtn.height / 2); Api.action("start_timer", { minutes: page.length }); }
                }
            }
            Btn { icon: "plus"; onClicked: dialog.ask(true) }
        }

        ColumnLayout {
            visible: page.upcoming.length > 0
            Layout.fillWidth: true
            Layout.topMargin: 18
            spacing: 0
            Section { Layout.fillWidth: true; text: "Upcoming" }
            Repeater {
                model: page.upcoming
                Rectangle {
                    id: row
                    required property var modelData
                    Layout.fillWidth: true
                    height: 50
                    color: "transparent"
                    Lively { key: "timer:" + row.modelData.id; sig: row.modelData.label + "|" + row.modelData.start_at }
                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: Theme.border }
                    RowLayout {
                        anchors { fill: parent; leftMargin: 4; rightMargin: 2 }
                        spacing: 14
                        Text { Layout.preferredWidth: 110; text: Util.clock(row.modelData.start_at); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 16; font.weight: Font.Bold }
                        Text { Layout.fillWidth: true; text: row.modelData.label; color: Theme.muted; elide: Text.ElideRight; font.family: Theme.mono; font.pixelSize: 14 }
                        Btn { compact: true; kind: "subtle"; icon: "trash"; onClicked: Api.action("update_timer", { timer_id: row.modelData.id, action: "stop" }) }
                    }
                }
            }
        }
    }

    // Length (and, for +, when it starts and a label).
    Modal {
        id: dialog
        property bool later: false
        title: later ? "Timer for later" : "Timer length"
        width: 420
        function ask(isLater) {
            later = isLater;
            minsF.text = String(page.length);
            atF.text = "";
            labelF.text = "";
            open();
            minsF.forceActiveFocus();
            minsF.selectAll();
        }
        function submit() {
            if (!minsF.acceptableInput || (later && !Util.isTime(atF.text))) return;
            if (later) Api.action("start_timer", { minutes: Number(minsF.text), at: Util.parseTime(atF.text), label: labelF.text });
            else page.length = Math.max(1, Math.round(Number(minsF.text)));
            close();
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 10
            RowLayout {
                spacing: 10
                Field {
                    id: minsF
                    Layout.preferredWidth: 100
                    validator: DoubleValidator { bottom: 0.1; top: 1440 }
                    onAccepted: dialog.submit()
                }
                Text { text: "minutes"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14 }
            }
            Flow {
                Layout.fillWidth: true
                spacing: 6
                Repeater {
                    model: [5, 10, 15, 25, 30, 45, 60]
                    Btn { required property int modelData; compact: true; kind: "subtle"; text: modelData + " min"; onClicked: minsF.text = String(modelData) }
                }
            }
            Field { id: atF; visible: dialog.later; Layout.fillWidth: true; placeholderText: "Starts at, e.g. 3:30 PM"; invalid: text !== "" && !Util.isTime(text); onAccepted: dialog.submit() }
            Field { id: labelF; visible: dialog.later; Layout.fillWidth: true; placeholderText: "Label (optional)"; onAccepted: dialog.submit() }
        }
        footer: [
            Item { Layout.fillWidth: true },
            Btn { text: "Cancel"; onClicked: dialog.close() },
            Btn { kind: "primary"; text: dialog.later ? "Schedule" : "Set"; enabled: minsF.acceptableInput && (!dialog.later || Util.isTime(atF.text)); onClicked: dialog.submit() }
        ]
    }
}
