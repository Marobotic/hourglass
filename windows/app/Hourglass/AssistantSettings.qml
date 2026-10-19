import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Which AI answers in the assistant: opencode's free models, Claude with the
// user's subscription or API key, or another OpenAI-compatible API. The key
// goes to the server once, stored encrypted there, and is never shown again.
Modal {
    id: dlg
    title: "Assistant AI"
    subtitle: "Pick who answers. Keys are stored encrypted on your account."
    width: Math.min(560, (parent ? parent.width : 560) - 48)
    signal saved()

    property var s: null            // the server's settings
    property string engine: "free"
    property string model: ""
    property string baseUrl: ""
    property var apiModels: []      // an OpenAI-compatible API's models
    property string error: ""
    property string note: ""
    property bool saving: false

    readonly property var engineInfo: s ? (s.engines.find(e => e.id === engine) || null) : null
    readonly property bool needsKey: engine !== "free"
    readonly property bool hasKey: !!(s && s.has_key && s.has_key[engine === "openai" ? "openai:" + baseUrl : engine])

    function load() {
        error = ""; note = "";
        Api.request("GET", "/api/assistant/settings", null, (d, err) => {
            if (!d) { dlg.error = err || "Could not load the settings."; return; }
            dlg.s = d;
            dlg.engine = d.engine;
            dlg.model = d.model || "";
            dlg.baseUrl = d.base_url || d.presets[0].base_url;
            keyField.text = "";
            if (dlg.engine === "openai") dlg.loadModels();
        }, true);
    }
    function loadModels() {
        apiModels = [];
        Api.request("GET", "/api/assistant/models?base_url=" + encodeURIComponent(baseUrl), null, (d) => {
            if (d && d.models) dlg.apiModels = d.models;
            if (d && d.error && dlg.hasKey) dlg.note = d.error;
        }, true);
    }
    function modelOptions() {
        if (!s) return [];
        if (engine === "free") return s.free_models.map(m => ({ label: m.name, value: m.id }));
        if (engine === "anthropic" || engine === "claude") return s.claude_models.map(m => ({ label: m.name + "  · " + m.note, value: m.id }));
        return apiModels.map(m => ({ label: m.id, value: m.id }));
    }
    function save() {
        error = ""; saving = true;
        const opts = modelOptions();
        const body = { engine: engine, model: model || (opts.length ? opts[0].value : "") };
        if (engine === "openai") body.base_url = baseUrl;
        if (keyField.text.trim() !== "") body.key = keyField.text.trim();
        Api.request("POST", "/api/assistant/settings", body, (d, err) => {
            dlg.saving = false;
            if (!d) { dlg.error = err || "Could not save."; return; }
            dlg.s.has_key = d.has_key;
            keyField.text = "";
            dlg.saved();
            dlg.close();
        }, true);
    }

    onOpened: load()

    // The engines, one row each.
    Repeater {
        model: dlg.s ? dlg.s.engines : []
        Rectangle {
            required property var modelData
            readonly property bool on: dlg.engine === modelData.id
            Layout.fillWidth: true
            implicitHeight: engineText.implicitHeight + 18
            color: on ? Theme.surface2 : "transparent"
            border.width: 1
            border.color: on ? Theme.accent : Theme.border
            RowLayout {
                anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
                spacing: 12
                Rectangle {
                    width: 14; height: 14
                    color: "transparent"
                    border.width: 2
                    border.color: on ? Theme.accent : Theme.muted
                    Rectangle { anchors.centerIn: parent; width: 6; height: 6; color: Theme.accent; visible: on }
                }
                ColumnLayout {
                    id: engineText
                    Layout.fillWidth: true
                    spacing: 1
                    Text { text: modelData.name; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 14; font.weight: on ? Font.DemiBold : Font.Normal }
                    Text { Layout.fillWidth: true; text: modelData.note; color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 12 }
                }
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (dlg.engine === modelData.id) return;
                    dlg.engine = modelData.id;
                    dlg.model = "";
                    dlg.error = ""; dlg.note = "";
                    keyField.text = "";
                    if (dlg.engine === "openai") dlg.loadModels();
                }
            }
        }
    }

    // An OpenAI-compatible API: which one.
    ColumnLayout {
        visible: dlg.engine === "openai"
        Layout.fillWidth: true
        spacing: 6
        Text { text: "API"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.letterSpacing: 1 }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            Repeater {
                model: dlg.s ? dlg.s.presets : []
                Btn { required property var modelData; compact: true; text: modelData.name; active: dlg.baseUrl === modelData.base_url; kind: "subtle"; onClicked: { dlg.baseUrl = modelData.base_url; dlg.model = ""; dlg.loadModels(); } }
            }
        }
        Field { Layout.fillWidth: true; text: dlg.baseUrl; placeholderText: "https://…/v1"; onEditingFinished: { if (text !== dlg.baseUrl) { dlg.baseUrl = text.trim(); dlg.model = ""; dlg.loadModels(); } } }
    }

    // The key or token.
    ColumnLayout {
        visible: dlg.needsKey
        Layout.fillWidth: true
        spacing: 6
        Text {
            text: dlg.engine === "claude" ? "CLAUDE TOKEN" : "API KEY"
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.letterSpacing: 1
        }
        Text {
            visible: dlg.engine === "claude"
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: "In a terminal with Claude Code installed, run  claude setup-token  and sign in with your Claude account. Paste the token it prints (sk-ant-oat…)."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
        }
        Field {
            id: keyField
            Layout.fillWidth: true
            echoMode: TextInput.Password
            placeholderText: dlg.hasKey ? "Saved ✓  (paste a new one to replace it)" : dlg.engine === "claude" ? "sk-ant-oat…" : dlg.engine === "anthropic" ? "sk-ant-api…" : "Your API key"
        }
        Text {
            visible: dlg.engine === "claude" && dlg.s && !dlg.s.claude_ready
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: "Claude Code isn't installed on the server yet: this choice will work once it is."
            color: Theme.gold; font.family: Theme.mono; font.pixelSize: 12
        }
    }

    // The model.
    ColumnLayout {
        Layout.fillWidth: true
        spacing: 6
        Text { text: "MODEL"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 11; font.letterSpacing: 1 }
        Picker {
            Layout.fillWidth: true
            options: dlg.modelOptions()
            value: dlg.model || (options.length ? options[0].value : null)
            onPicked: v => dlg.model = v
        }
        Text {
            visible: dlg.engine === "openai" && dlg.apiModels.length === 0
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: dlg.hasKey ? "Loading this API's models…" : "Save your key first, then pick a model."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
        }
    }

    Text { visible: dlg.note !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: dlg.note; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
    Text { visible: dlg.error !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: dlg.error; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }

    footer: [
        Item { Layout.fillWidth: true },
        Btn { text: "Cancel"; onClicked: dlg.close() },
        Btn {
            text: dlg.saving ? "Checking…" : "Save"
            kind: "primary"
            enabled: !dlg.saving && (!dlg.needsKey || dlg.hasKey || keyField.text.trim() !== "")
            onClicked: dlg.save()
        }
    ]
}
