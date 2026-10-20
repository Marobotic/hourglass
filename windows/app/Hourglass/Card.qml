import QtQuick

Rectangle {
    id: card
    property bool hoverable: false
    property color stripe: "transparent"
    signal clicked()
    readonly property bool hovered: mouse.containsMouse

    radius: 0
    color: hoverable && hovered ? Theme.surface2 : Theme.surface
    border.width: 1
    border.color: hoverable && hovered ? Theme.faint : Theme.border
    Behavior on color { ColorAnimation { duration: 90 } }

    // A hoverable card lifts a pixel and casts a square shadow, like Tasks' cards.
    transform: Translate { y: card.hoverable && card.hovered ? -2 : 0; Behavior on y { NumberAnimation { duration: 160; easing.type: Easing.OutBack } } }
    Rectangle {
        z: -2
        x: 3; y: 3
        width: card.width; height: card.height
        color: "#000000"
        opacity: card.hoverable && card.hovered ? 0.35 : 0
        Behavior on opacity { NumberAnimation { duration: 140 } }
    }

    Rectangle {
        visible: card.stripe.a > 0
        width: 4
        radius: 0
        color: card.stripe
        anchors { left: parent.left; top: parent.top; bottom: parent.bottom; margins: 1 }
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        enabled: card.hoverable
        hoverEnabled: card.hoverable
        cursorShape: card.hoverable ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: card.clicked()
        z: -1
    }
}
