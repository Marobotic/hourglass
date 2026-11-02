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
    property string deepSeekPriceLine: ""
    property string error: ""
    property string note: ""
    property bool saving: false

    readonly property var engineInfo: s ? (s.engines.find(e => e.id === engine) || null) : null
    readonly property bool needsKey: engine !== "free"
    readonly property bool hasKey: !!(s && s.has_key && s.has_key[engine === "openai" ? "openai:" + baseUrl : engine])
    readonly property bool deepSeekSelected: engine === "openai" && baseUrl.indexOf("api.deepseek.com") >= 0

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
            dlg.loadDeepSeekPrice();
        }, true);
    }
    function loadModels() {
        apiModels = [];
        Api.request("GET", "/api/assistant/models?base_url=" + encodeURIComponent(baseUrl), null, (d) => {
            if (d && d.models) dlg.apiModels = d.models;
            if (d && d.error && dlg.hasKey) dlg.note = d.error;
        }, true);
    }
    function loadDeepSeekPrice() {
        if (!deepSeekSelected) { deepSeekPriceLine = ""; return; }
        Api.request("GET", "/api/assistant/deepseek-pricing", null, d => { if (d) dlg.deepSeekPriceLine = d.line || ""; }, true);
    }
    function modelOptions() {
        if (!s) return [];
        if (engine === "free") return s.free_models.map(m => ({ label: m.name, value: m.id }));
        if (engine === "anthropic" || engine === "claude") return s.claude_models.map(m => ({ label: modelLabel(m), value: m.id }));
        return apiModels.map(m => ({ label: modelLabel(m), value: m.id }));
    }
    function modelLabel(m) {
        let label = m.name || m.id;
        if (m.note) label += "  · " + m.note;
        if (m.supports_tools === false) label += "  · tools unsupported";
        if (m.context_window) label += "  · " + (m.context_window >= 1000000 ? (m.context_window / 1000000).toFixed(1).replace(/\.0$/, "") + "M" : Math.round(m.context_window / 1000) + "k");
        if (m.pricing && m.pricing.input !== undefined && m.pricing.output !== undefined)
            label += "  · $" + (m.pricing.input * 1000000).toPrecision(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + "/$" + (m.pricing.output * 1000000).toPrecision(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + " per 1M";
        return label;
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

    Text {
        visible: dlg.s && dlg.s.claude_model_source === "fallback" && (dlg.engine === "claude" || dlg.engine === "anthropic")
        text: "Using the default Claude model list."
        color: Theme.muted
        font.family: Theme.mono
        font.pixelSize: 11
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
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
                Btn { required property var modelData; compact: true; text: modelData.name; active: dlg.baseUrl === modelData.base_url; kind: "subtle"; onClicked: { dlg.baseUrl = modelData.base_url; dlg.model = ""; dlg.loadModels(); dlg.loadDeepSeekPrice(); } }
            }
        }
        Field { Layout.fillWidth: true; text: dlg.baseUrl; placeholderText: "https://…/v1"; onEditingFinished: { if (text !== dlg.baseUrl) { dlg.baseUrl = text.trim(); dlg.model = ""; dlg.loadModels(); dlg.loadDeepSeekPrice(); } } }
    }

    // Claude plan: sign in in the browser. The server runs Claude Code's own sign-in;
    // claude.com shows a code at the end, which goes back here.
    property string signin: ""       // "", "starting", "waiting" (browser open), "finishing"
    property string signinMessage: "Paste the code from claude.com"
    Timer { id: claudePoll; interval: 1000; repeat: true; onTriggered: Api.request("GET", "/api/assistant/claude/login/status", null, (d) => {
        if (!d) return;
        dlg.signin = d.state === "waiting_code" ? "waiting" : d.state; dlg.signinMessage = d.message || "";
        if (d.state === "connected") { stop(); dlg.signin = ""; dlg.codeField.text = ""; dlg.load(); dlg.note = d.message; }
        else if (d.state === "error") { stop(); dlg.signin = ""; dlg.error = d.message; }
    }, true) }
    function startSignin() {
        error = ""; note = ""; signin = "starting";
        Api.request("POST", "/api/assistant/claude/login", {}, (d, err) => {
            if (!d) { dlg.signin = ""; dlg.error = err || "Could not start the sign-in."; return; }
            dlg.signin = "waiting"; dlg.signinMessage = "Paste the code from claude.com"; claudePoll.start();
            if (!Qt.openUrlExternally(d.url)) { dlg.signin = ""; dlg.error = "Could not open claude.com. Open the link again or paste a token instead."; Api.request("POST", "/api/assistant/claude/login/cancel", {}, () => {}, true); return; }
            codeField.forceActiveFocus();
        }, true);
    }
    function finishSignin() {
        error = ""; signin = "connecting";
        Api.request("POST", "/api/assistant/claude/login/code", { code: codeField.text.trim(), async: true }, (d, err) => {
            if (!d) { dlg.signin = ""; dlg.error = err || "Could not finish the sign-in."; return; }
            dlg.signin = "connecting"; dlg.signinMessage = "Connecting…";
        }, true);
    }
    onClosed: if (signin !== "") { Api.request("POST", "/api/assistant/claude/login/cancel", {}, () => {}, true); signin = ""; }

    ColumnLayout {
        visible: dlg.engine === "claude"
        Layout.fillWidth: true
        spacing: 8
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Btn {
                text: dlg.signin === "starting" ? "Opening claude.com…" : dlg.hasKey ? "Sign in again" : "Sign in with Claude"
                kind: dlg.hasKey ? "ghost" : "primary"
                enabled: dlg.signin === "" && !!dlg.s && dlg.s.claude_ready
                onClicked: dlg.startSignin()
            }
            Text {
                Layout.fillWidth: true
                visible: dlg.hasKey && dlg.signin === ""
                text: "✓ Connected as Claude Pro/Max"
                color: Theme.teal; font.family: Theme.mono; font.pixelSize: 12
            }
        }
        Text {
            visible: dlg.signin === "waiting" || dlg.signin === "connecting" || dlg.signin === "checking"
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: dlg.signin === "waiting" ? "Paste the code from claude.com" : dlg.signin === "connecting" ? "Connecting…" : dlg.signin === "checking" ? "Checking your Claude plan…" : dlg.signinMessage
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
        }
        RowLayout {
            visible: dlg.signin === "waiting" || dlg.signin === "connecting" || dlg.signin === "checking"
            Layout.fillWidth: true
            spacing: 8
            Field { id: codeField; Layout.fillWidth: true; placeholderText: "Code, callback URL, or sk-ant-oat token"; onAccepted: if (text.trim() !== "") dlg.finishSignin() }
            Btn { text: dlg.signin === "waiting" ? "Connect" : dlg.signin === "checking" ? "Checking…" : "Connecting…"; kind: "primary"; enabled: dlg.signin === "waiting" && codeField.text.trim() !== ""; onClicked: dlg.finishSignin() }
        }
    }

    // The key or token.
    ColumnLayout {
        visible: dlg.needsKey && dlg.engine !== "claude"
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
            text: "On your own PC, run  claude setup-token  in a terminal with Claude Code installed. Sign in, then paste the sk-ant-oat token it prints here."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
        }
        Field {
            id: keyField
            Layout.fillWidth: true
            echoMode: TextInput.Password
            placeholderText: dlg.hasKey ? "Saved ✓  (paste a new one to replace it)" : dlg.engine === "claude" ? "sk-ant-oat…" : dlg.engine === "anthropic" ? "sk-ant-api…" : "Your API key"
        }
        Text {
            visible: dlg.deepSeekSelected
            text: "<a href=\"https://platform.deepseek.com/api_keys\">Get a DeepSeek API key</a>"
            textFormat: Text.RichText
            color: Theme.muted
            linkColor: Theme.fg
            font.family: Theme.mono
            font.pixelSize: 11
            onLinkActivated: link => Qt.openUrlExternally(link)
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
            visible: dlg.engine === "free" && dlg.s && dlg.s.free_model_discovery.status === "discovery failed"
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: "Model discovery failed; showing the configured fallback models."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
        }
        Text {
            visible: dlg.engine === "openai" && dlg.apiModels.length === 0
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: dlg.hasKey ? "Loading this API's models…" : "Save your key first, then pick a model."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 12
        }
        Text {
            visible: dlg.deepSeekSelected && dlg.deepSeekPriceLine !== ""
            Layout.fillWidth: true
            text: dlg.deepSeekPriceLine
            color: Theme.faint
            font.family: Theme.mono
            font.pixelSize: 11
        }
    }

    Timer { interval: 60000; repeat: true; running: dlg.deepSeekSelected; onTriggered: dlg.loadDeepSeekPrice() }

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
