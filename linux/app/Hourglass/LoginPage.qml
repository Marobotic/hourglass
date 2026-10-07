import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Signed out, this is the whole app: sign in or create an account (the
// Jukebox account, one for both), same shape as the phone apps.
Rectangle {
    id: login
    property var app
    property string error: ""
    property bool busy: false
    property bool creating: false
    property bool forgot: false   // "Forgot password?": email only, sends a reset link
    property string notice: ""
    color: Theme.bg

    // Checked here first, so the common mistakes never make a round trip.
    function submit() {
        if (busy) return;
        const e = email.text.trim();
        notice = "";
        if (forgot) {
            error = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? "Enter a valid email address." : "";
            if (error) return;
            busy = true;
            Api.request("POST", "/api/account/forgot", { email: e }, (d, err) => {
                login.busy = false;
                if (err) login.error = err;
                else login.notice = "If " + e + " has an account, a reset link is on its way. Open it on any device; it works for one hour.";
            }, true);
            return;
        }
        error = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? "Enter a valid email address."
            : password.text.length < 8 ? "The password needs at least 8 characters."
            : creating && confirm.text !== password.text ? "The passwords do not match." : "";
        if (error) return;
        busy = true;
        Api.request("POST", creating ? "/api/account/register" : "/api/account/login", { email: e, password: password.text }, (d, err) => {
            login.busy = false;
            if (err) login.error = err;
            else { password.text = ""; login.app.pollState(); }
        }, false);
    }

    function setMode(create, lost) { creating = create; forgot = lost; error = ""; notice = ""; }

    // The last account's email, as a starting point, when the page comes up.
    function prefill() {
        const a = app && app.appState ? app.appState.account : null;
        if (email.text === "" && a && a.email) email.text = a.email;
    }
    onVisibleChanged: if (visible) prefill()
    Component.onCompleted: { prefill(); if (app && app.devLoginMode) setMode(app.devLoginMode === "create", app.devLoginMode === "forgot"); }

    MouseArea { anchors.fill: parent } // nothing behind it takes clicks

    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(parent.width - 48, 380)
        spacing: 12

        Logo { Layout.alignment: Qt.AlignHCenter; cell: 7 }
        Text { Layout.alignment: Qt.AlignHCenter; Layout.topMargin: 10; text: "Hourglass"; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 26; font.weight: Font.Bold }
        Text {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            text: "Your schedule and notes, on every device."
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14; lineHeight: 1.25
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.topMargin: 12
            implicitHeight: form.implicitHeight + 40
            color: Theme.surface
            border.width: 1
            border.color: Theme.border
            ColumnLayout {
                id: form
                anchors { left: parent.left; right: parent.right; top: parent.top; margins: 20 }
                spacing: 10
                // The two-way Sign in / Create account switch.
                Rectangle {
                    visible: !login.forgot
                    Layout.fillWidth: true
                    Layout.bottomMargin: 6
                    implicitHeight: 40
                    color: Theme.bg
                    border.width: 1
                    border.color: Theme.border
                    RowLayout {
                        anchors { fill: parent; margins: 4 }
                        spacing: 0
                        Repeater {
                            model: [["Sign in", false], ["Create account", true]]
                            Rectangle {
                                required property var modelData
                                readonly property bool on: login.creating === modelData[1]
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                color: on ? Theme.surface2 : "transparent"
                                Text { anchors.centerIn: parent; text: parent.modelData[0]; color: parent.on ? Theme.fg : Theme.muted; font.family: Theme.mono; font.pixelSize: 14; font.weight: parent.on ? Font.Bold : Font.Normal }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: login.setMode(parent.modelData[1], false) }
                            }
                        }
                    }
                }
                Text {
                    visible: login.forgot
                    Layout.fillWidth: true; wrapMode: Text.Wrap
                    text: "Forgot your password? Enter your email and we'll send you a link to choose a new one."
                    color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13; lineHeight: 1.25
                }
                Text { text: "EMAIL"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field {
                    id: email
                    Layout.fillWidth: true
                    implicitHeight: 42
                    // Filled in once, never bound: appState is replaced whenever
                    // the sync loop moves (last_ok, pending), and a binding here
                    // put the saved email back over whatever was being typed -
                    // every few seconds, for good.
                    inputMethodHints: Qt.ImhEmailCharactersOnly | Qt.ImhNoAutoUppercase
                    onAccepted: login.forgot ? login.submit() : password.forceActiveFocus()
                }
                Text { visible: !login.forgot; Layout.topMargin: 4; text: "PASSWORD"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field { id: password; visible: !login.forgot; Layout.fillWidth: true; implicitHeight: 42; echoMode: TextInput.Password; onAccepted: login.creating ? confirm.forceActiveFocus() : login.submit() }
                Text { visible: login.creating; Layout.topMargin: 4; text: "CONFIRM PASSWORD"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field { id: confirm; visible: login.creating; Layout.fillWidth: true; implicitHeight: 42; echoMode: TextInput.Password; onAccepted: login.submit() }
                Text {
                    visible: !login.creating && !login.forgot
                    Layout.alignment: Qt.AlignRight
                    text: "Forgot password?"
                    color: forgotMouse.containsMouse ? Theme.fg : Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.underline: forgotMouse.containsMouse
                    MouseArea { id: forgotMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: login.setMode(false, true) }
                }
                Text {
                    visible: !login.forgot
                    Layout.fillWidth: true; wrapMode: Text.Wrap
                    text: login.creating ? "At least 8 characters." : "The same account as Jukebox. Your other devices use it too."
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
                }
                Text { visible: login.notice !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: login.notice; color: Theme.teal; font.family: Theme.mono; font.pixelSize: 13; lineHeight: 1.2 }
                Text { visible: login.error !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: login.error; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                Btn {
                    Layout.fillWidth: true
                    Layout.topMargin: 6
                    kind: "primary"
                    text: login.forgot ? (login.busy ? "Sending…" : "Send reset link")
                        : login.busy ? (login.creating ? "Creating account…" : "Signing in…") : (login.creating ? "Create account" : "Sign in")
                    enabled: !login.busy
                    onClicked: login.submit()
                }
            }
        }
        Text {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            text: (login.forgot ? "Remembered it? " : login.creating ? "Already have an account? " : "New here? ") + "<b><font color='" + Theme.accent + "'>" + (login.forgot || login.creating ? "Sign in" : "Create an account") + "</font></b>"
            textFormat: Text.StyledText
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: login.setMode(!login.creating && !login.forgot, false) }
        }
    }
}
