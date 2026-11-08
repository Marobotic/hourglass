import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// What the assistant has used and what is left: per day, per engine, the limits
// that apply, a limit in force, and DeepSeek's peak-hour price. From GET /api/assistant/usage.
AssistantSettingsPage {
    id: dlg
    title: "Assistant usage"
    subtitle: "Tokens and cost of your assistant, kept for 90 days."

    property var u: null
    property string error: ""
    property int range: 14
    readonly property var days: u && u.days ? u.days.slice(-range) : []
    readonly property real peakTokens: days.reduce((m, d) => Math.max(m, d.tokens || 0), 1)

    function load() {
        error = "";
        Api.request("GET", "/api/assistant/usage?days=" + Math.max(range, 30), null, (d, err) => {
            if (!d) { error = err || "Could not load the usage."; return; }
            u = d;
        }, true);
    }
    function count(n) {
        n = Number(n || 0);
        return n >= 1000000 ? (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
    }
    function money(row) {
        if (!row || row.cost === null || row.cost === undefined) return row && row.runs ? "price unknown" : "–";
        return "$" + Number(row.cost).toFixed(row.cost < 1 ? 4 : 2) + (row.unpriced_runs ? " + " + row.unpriced_runs + " unpriced" : "");
    }
    function until(ms) {
        if (!ms) return "";
        const d = new Date(ms);
        const same = d.toDateString() === new Date().toDateString();
        return (same ? "" : d.toLocaleDateString(Qt.locale(), "ddd d MMM") + " ") + d.toLocaleTimeString(Qt.locale(), "HH:mm");
    }
    onOpened: load()

    component Stat: ColumnLayout {
        property string label: ""
        property string value: ""
        property string note: ""
        spacing: 2
        Text { text: label.toUpperCase(); color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
        Text { text: value; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 20; font.weight: Font.DemiBold }
        Text { visible: note !== ""; text: note; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
    }

    Text { visible: dlg.error !== ""; Layout.fillWidth: true; text: dlg.error; color: Theme.accent; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12 }
    Text { visible: !dlg.u && dlg.error === ""; text: "Loading…"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }

    // A limit in force: quiet, with when it ends.
    Text {
        visible: !!dlg.u && !!dlg.u.quota
        Layout.fillWidth: true
        text: dlg.u && dlg.u.quota ? "Limit reached" + (dlg.u.quota.resets_at ? ", continues at " + dlg.until(dlg.u.quota.resets_at) : "") + (dlg.u.quota.message ? " · " + dlg.u.quota.message : "") : ""
        color: Theme.accent; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12
    }

    RowLayout {
        visible: !!dlg.u
        Layout.fillWidth: true
        spacing: 40
        Stat { label: "Today"; value: dlg.u ? dlg.count(dlg.u.today.tokens) + " tokens" : ""; note: dlg.u ? dlg.u.today.runs + " answers · " + dlg.money(dlg.u.today) : "" }
        Stat { label: "Last " + Math.max(dlg.range, 30) + " days"; value: dlg.u ? dlg.count(dlg.u.totals.tokens) + " tokens" : ""; note: dlg.u ? dlg.u.totals.runs + " answers · " + dlg.money(dlg.u.totals) : "" }
        Stat {
            visible: !!dlg.u && !!dlg.u.context && !!dlg.u.context.window
            label: "Context"
            value: dlg.u && dlg.u.context && dlg.u.context.percent !== null && dlg.u.context.percent !== undefined ? Number(dlg.u.context.percent).toFixed(1).replace(/\.0$/, "") + "%" : ""
            note: dlg.u && dlg.u.context ? "of " + dlg.count(dlg.u.context.window) : ""
        }
    }

    // Tokens per day, oldest first.
    ColumnLayout {
        visible: !!dlg.u
        Layout.fillWidth: true
        spacing: 8
        RowLayout {
            Layout.fillWidth: true
            Text { Layout.fillWidth: true; text: "PER DAY"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
            Repeater {
                model: [7, 14, 30]
                Rectangle {
                    required property int modelData
                    implicitWidth: rangeLabel.implicitWidth + 16; implicitHeight: 24
                    color: dlg.range === modelData ? Theme.accent : Theme.surface2
                    border.width: 1; border.color: dlg.range === modelData || rangeHover.containsMouse ? Theme.accent : Theme.border
                    Text { id: rangeLabel; anchors.centerIn: parent; text: modelData + " d"; color: dlg.range === modelData ? Theme.accentInk : Theme.fg; font.family: Theme.mono; font.pixelSize: 11 }
                    MouseArea { id: rangeHover; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: dlg.range = modelData }
                }
            }
        }
        Row {
            Layout.fillWidth: true
            Layout.preferredHeight: 96
            spacing: 2
            Repeater {
                model: dlg.days
                Item {
                    required property var modelData
                    width: Math.max(2, (dlg.width - 40 - 2 * (dlg.days.length - 1)) / Math.max(1, dlg.days.length))
                    height: 96
                    Rectangle {
                        anchors.bottom: parent.bottom
                        width: parent.width
                        height: Math.max(modelData.tokens ? 2 : 0, 96 * (modelData.tokens || 0) / dlg.peakTokens)
                        color: modelData.date === (dlg.u && dlg.u.today ? dlg.u.today.date : "") ? Theme.accent : Theme.alpha(Theme.accent, 0.5)
                    }
                    MouseArea { id: barHover; anchors.fill: parent; hoverEnabled: true }
                    ToolTip.visible: barHover.containsMouse
                    ToolTip.text: modelData.date + " · " + dlg.count(modelData.tokens) + " tokens · " + modelData.runs + " answers · " + dlg.money(modelData)
                }
            }
        }
    }

    // Per engine.
    ColumnLayout {
        visible: !!dlg.u && dlg.u.engines && dlg.u.engines.length > 0
        Layout.fillWidth: true
        spacing: 4
        Text { text: "PER ENGINE"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
        Repeater {
            model: dlg.u && dlg.u.engines ? dlg.u.engines : []
            Rectangle {
                required property var modelData
                Layout.fillWidth: true
                implicitHeight: 40
                color: Theme.surface; border.width: 1; border.color: Theme.border
                RowLayout {
                    anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
                    spacing: 12
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0
                        Text { text: modelData.engine; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 12 }
                        Text { Layout.fillWidth: true; visible: !!modelData.models && modelData.models.length > 0; text: (modelData.models || []).join(", "); elide: Text.ElideRight; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10 }
                    }
                    Text { text: modelData.runs + " answers"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
                    Text { text: dlg.count(modelData.tokens) + " tokens"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11 }
                    Text { text: dlg.money(modelData); color: Theme.fg; font.family: Theme.mono; font.pixelSize: 11 }
                }
            }
        }
    }

    // What limits it.
    ColumnLayout {
        visible: !!dlg.u
        Layout.fillWidth: true
        spacing: 4
        Text { text: "LIMITS"; color: Theme.faint; font.family: Theme.mono; font.pixelSize: 10; font.letterSpacing: 1 }
        Text {
            Layout.fillWidth: true
            text: dlg.u && dlg.u.limits ? dlg.u.limits.messages_per_hour + " messages an hour · " + dlg.u.limits.max_queued + " waiting at most" + (dlg.u.limits.plan ? " · plan: " + dlg.u.limits.plan : "") : ""
            color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12
        }
        Text {
            visible: !!dlg.u && !!dlg.u.deepseek && !!dlg.u.deepseek.line && !!dlg.u.model && /deepseek/i.test(dlg.u.model + dlg.u.engine_name)
            Layout.fillWidth: true
            text: dlg.u && dlg.u.deepseek ? "DeepSeek: " + dlg.u.deepseek.line : ""
            color: dlg.u && dlg.u.deepseek && dlg.u.deepseek.peak ? Theme.gold : Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12
        }
        Repeater {
            model: dlg.u && dlg.u.quotas ? dlg.u.quotas : []
            Text {
                required property var modelData
                Layout.fillWidth: true
                text: (modelData.engine || "") + ": " + (modelData.message || "limit reached") + (modelData.resets_at ? " · continues at " + dlg.until(modelData.resets_at) : "")
                color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12
            }
        }
    }
}
