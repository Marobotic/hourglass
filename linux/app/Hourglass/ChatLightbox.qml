import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Popup {
    id: box
    parent: Overlay.overlay
    width: parent ? parent.width : 0; height: parent ? parent.height : 0
    padding: 0; modal: true; focus: true
    closePolicy: Popup.CloseOnEscape
    property var images: []
    property int current: 0
    property real zoom: 1
    property real panX: 0
    property real panY: 0
    readonly property var image: images[current] || ({})
    readonly property real fit: picture.implicitWidth > 0 && picture.implicitHeight > 0
        ? Math.min(viewport.width / picture.implicitWidth, viewport.height / picture.implicitHeight) : 1
    function reset() { zoom = 1; panX = 0; panY = 0; }
    function show(items, at) { images = items; current = Math.max(0, at); reset(); open(); }
    function step(by) { if (images.length > 1) { current = (current + by + images.length) % images.length; reset(); } }
    function scaleBy(factor, px, py) {
        const next = Math.max(0.1, Math.min(32, zoom * factor)), ratio = next / zoom;
        panX = px - viewport.width / 2 - (px - viewport.width / 2 - panX) * ratio;
        panY = py - viewport.height / 2 - (py - viewport.height / 2 - panY) * ratio;
        zoom = next;
    }
    background: Rectangle { color: Theme.bg }
    enter: Transition { NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 150 } }
    exit: Transition { NumberAnimation { property: "opacity"; to: 0; duration: 100 } }
    contentItem: Item {
        focus: true
        Keys.onLeftPressed: box.step(-1)
        Keys.onRightPressed: box.step(1)
        Keys.onEscapePressed: box.close()
        Item {
            id: viewport
            anchors { fill: parent; topMargin: 58; bottomMargin: 20; leftMargin: 20; rightMargin: 20 }
            clip: true
            Image {
                id: picture
                objectName: "lightboxImage"
                source: box.image.url || ""
                width: implicitWidth * box.fit * box.zoom; height: implicitHeight * box.fit * box.zoom
                x: (viewport.width - width) / 2 + box.panX; y: (viewport.height - height) / 2 + box.panY
                asynchronous: true; fillMode: Image.PreserveAspectFit
                onStatusChanged: if (status === Image.Ready) box.reset()
            }
            Text {
                anchors.centerIn: parent
                visible: picture.status !== Image.Ready
                text: picture.status === Image.Error ? "Could not load this image" : "Loading image…"
                color: Theme.muted; font.family: Theme.mono; font.pixelSize: 14
            }
            MouseArea {
                anchors.fill: parent
                property real lastX: 0
                property real lastY: 0
                property bool moved: false
                cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                onPressed: mouse => { lastX = mouse.x; lastY = mouse.y; moved = false; }
                onPositionChanged: mouse => {
                    if (!pressed) return;
                    const dx = mouse.x - lastX, dy = mouse.y - lastY;
                    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
                    box.panX += dx; box.panY += dy; lastX = mouse.x; lastY = mouse.y;
                }
                onClicked: mouse => {
                    if (!moved && (mouse.x < picture.x || mouse.x > picture.x + picture.width || mouse.y < picture.y || mouse.y > picture.y + picture.height)) box.close();
                }
                onDoubleClicked: { box.zoom = Math.abs(box.zoom - 1) < 0.01 ? 1 / box.fit : 1; box.panX = 0; box.panY = 0; }
                onWheel: wheel => { box.scaleBy(Math.pow(1.0015, wheel.angleDelta.y), wheel.x, wheel.y); wheel.accepted = true; }
            }
        }
        RowLayout {
            anchors { left: parent.left; right: parent.right; top: parent.top; margins: 14 }
            spacing: 10
            Text { Layout.fillWidth: true; text: box.image.name || "Image"; elide: Text.ElideMiddle; color: Theme.fg; font.family: Theme.mono; font.pixelSize: 13 }
            Text { text: (box.current + 1) + " / " + box.images.length; color: Theme.muted; font.family: Theme.mono; font.pixelSize: 12 }
            Btn { compact: true; text: "Previous"; enabled: box.images.length > 1; onClicked: box.step(-1) }
            Btn { compact: true; text: "Next"; enabled: box.images.length > 1; onClicked: box.step(1) }
            Btn { compact: true; text: "Fit"; onClicked: box.reset() }
            Btn { compact: true; icon: "close"; tip: "Close (Esc)"; onClicked: box.close() }
        }
    }
}
