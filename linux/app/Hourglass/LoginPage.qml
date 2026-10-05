import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Signed out, this is the whole app: sign in or create an account (the
// Omarchy Music account, one for both), same shape as the phone apps.
Rectangle {
    id: login
    property var app
    property string error: ""
    property bool busy: false
    property bool creating: false
    color: Theme.bg

    // Checked here first, so the common mistakes never make a round trip.
    function submit() {
        if (busy) return;
        const e = email.text.trim();
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
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { login.creating = parent.modelData[1]; login.error = ""; } }
                            }
                        }
                    }
                }
                Text { text: "EMAIL"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field {
                    id: email
                    Layout.fillWidth: true
                    implicitHeight: 42
                    text: login.app.appState.account ? (login.app.appState.account.email || "") : ""
                    inputMethodHints: Qt.ImhEmailCharactersOnly | Qt.ImhNoAutoUppercase
                    onAccepted: password.forceActiveFocus()
                }
                Text { Layout.topMargin: 4; text: "PASSWORD"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field { id: password; Layout.fillWidth: true; implicitHeight: 42; echoMode: TextInput.Password; onAccepted: login.creating ? confirm.forceActiveFocus() : login.submit() }
                Text { visible: login.creating; Layout.topMargin: 4; text: "CONFIRM PASSWORD"; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12; font.letterSpacing: 1 }
                Field { id: confirm; visible: login.creating; Layout.fillWidth: true; implicitHeight: 42; echoMode: TextInput.Password; onAccepted: login.submit() }
                Text {
                    Layout.fillWidth: true; wrapMode: Text.Wrap
                    text: login.creating ? "At least 8 characters." : "The same account as Omarchy Music. Your other devices use it too."
                    color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12
                }
                Text { visible: login.error !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: login.error; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                Btn {
                    Layout.fillWidth: true
                    Layout.topMargin: 6
                    kind: "primary"
                    text: login.busy ? (login.creating ? "Creating account…" : "Signing in…") : (login.creating ? "Create account" : "Sign in")
                    enabled: !login.busy
                    onClicked: login.submit()
                }
            }
        }
        Text {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            text: (login.creating ? "Already have an account? " : "New here? ") + "<b><font color='" + Theme.accent + "'>" + (login.creating ? "Sign in" : "Create an account") + "</font></b>"
            textFormat: Text.StyledText
            color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { login.creating = !login.creating; login.error = ""; } }
        }
    }
}
