import QtQuick

Rectangle {
    id: card
    property bool hoverable: false
    property color stripe: "transparent"
    signal clicked()
    readonly property bool hovered: mouse.containsMouse

    radius: Theme.radius
    color: hoverable && hovered ? Theme.surface2 : Theme.surface
    border.width: 1
    border.color: hoverable && hovered ? Theme.faint : Theme.border
    Behavior on color { ColorAnimation { duration: 90 } }

    Rectangle {
        visible: card.stripe.a > 0
        width: 4
        radius: 2
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
