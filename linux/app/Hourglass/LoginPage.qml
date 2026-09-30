import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Signed out, this is the whole app: the Omarchy Music account is the way in,
// same as the music player's sign-in.
Rectangle {
    id: login
    property var app
    property string error: ""
    property bool busy: false
    color: Theme.bg

    function submit() {
        if (busy || email.text.indexOf("@") < 1 || !password.text) return;
        busy = true;
        error = "";
        Api.request("POST", "/api/account/login", { email: email.text.trim(), password: password.text }, (d, err) => {
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
            text: "Sign in with your Omarchy Music account. Your schedule, notes, alarms and ringtones are shared between this computer and your phones."
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
                Field { id: password; Layout.fillWidth: true; implicitHeight: 42; echoMode: TextInput.Password; onAccepted: login.submit() }
                Text { visible: login.error !== ""; Layout.fillWidth: true; wrapMode: Text.Wrap; text: login.error; color: Theme.accent; font.family: Theme.mono; font.pixelSize: 13 }
                Btn {
                    Layout.fillWidth: true
                    Layout.topMargin: 6
                    kind: "primary"
                    text: login.busy ? "Signing in…" : "Sign in"
                    enabled: !login.busy && email.text.indexOf("@") > 0 && password.text.length > 0
                    onClicked: login.submit()
                }
            }
        }
        Text {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            text: "No account yet? Create one in Omarchy Music."
            color: Theme.faint; font.family: Theme.mono; font.pixelSize: 13
        }
    }
}
