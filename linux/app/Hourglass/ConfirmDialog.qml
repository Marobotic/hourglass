import QtQuick
import QtQuick.Layouts

Modal {
    id: cd
    property string message: ""
    property string confirmText: "Delete"
    property var onConfirm: null
    width: 420

    function ask(title, message, confirmText, fn) {
        cd.title = title;
        cd.message = message;
        cd.confirmText = confirmText || "Delete";
        cd.onConfirm = fn;
        open();
    }

    Text { Layout.fillWidth: true; text: cd.message; color: Theme.muted; wrapMode: Text.Wrap; font.family: Theme.mono; font.pixelSize: 13 }

    footer: [
        Item { Layout.fillWidth: true },
        Btn { text: "Cancel"; onClicked: cd.close() },
        Btn { text: cd.confirmText; kind: "primary"; onClicked: { cd.close(); if (cd.onConfirm) cd.onConfirm(); } }
    ]
}
