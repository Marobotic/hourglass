import QtQuick

// Nerd Font (Font Awesome range) glyphs by name.
Text {
    id: icon
    property string name: ""
    property int size: 15
    readonly property var glyphs: ({
        "now": "", "week": "", "courses": "", "time": "",
        "plus": "", "search": "", "pin": "", "place": "",
        "trash": "", "edit": "", "close": "", "check": "",
        "play": "", "pause": "", "stop": "", "left": "",
        "right": "", "note": "", "bell": "", "bell-off": "", "reminder": "",
        "sync": "", "cloud": "", "person": "", "back": "",
        "eye": "", "code": "", "bolt": "", "folder-open": "",
        "calendar-plus": "", "list": "", "timer": "", "down": "", "gear": "", "globe": ""
        , "bold": "", "italic": "", "underline": "", "strike": ""
        , "list-ul": "", "list-ol": "", "heading": "", "image": ""
        , "clip": "", "folder": "", "file": "", "upload": ""
        , "download": "", "check-square": "", "chat": "", "send": "", "drive": "", "user-check": ""
        , "link": "", "share": "", "move": "", "font": "", "text-size": "", "volume": "", "paper-plane": ""
    })
    text: glyphs[name] || ""
    font.family: Theme.mono
    font.pixelSize: size
    color: Theme.fg
    horizontalAlignment: Text.AlignHCenter
    verticalAlignment: Text.AlignVCenter
}
