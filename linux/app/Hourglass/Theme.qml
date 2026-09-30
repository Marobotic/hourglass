pragma Singleton
import QtQuick

// Colours follow the active Omarchy theme (sent by the sidecar), so the app
// re-colours with the desktop.
QtObject {
    id: t

    property color bg: "#121212"
    property color fg: "#f5f5f5"
    property color accent: "#B14242"
    property color orange: "#D66E36"
    property color gold: "#F0BE66"
    property color teal: "#4A8B8B"
    property color grey: "#949494"

    readonly property bool dark: bg.hslLightness < 0.5
    readonly property color surface: mix(bg, fg, dark ? 0.045 : 0.035)
    readonly property color surface2: mix(bg, fg, dark ? 0.085 : 0.07)
    readonly property color border: mix(bg, fg, dark ? 0.14 : 0.16)
    readonly property color muted: mix(bg, fg, 0.58)
    readonly property color faint: mix(bg, fg, 0.36)
    readonly property color accentInk: accent.hslLightness > 0.62 ? Qt.color("#121212") : Qt.color("#ffffff")

    readonly property string mono: "JetBrainsMono Nerd Font"
    readonly property string sans: "Noto Sans"

    readonly property int radius: 6
    readonly property int pad: 16

    function mix(a, b, k) {
        return Qt.rgba(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, 1);
    }
    // Course colours arrive from the API as "#rrggbb" strings.
    function alpha(c, a) {
        const k = typeof c === "string" ? Qt.color(c) : c;
        return Qt.rgba(k.r, k.g, k.b, a);
    }

    function apply(theme) {
        if (!theme) return;
        bg = theme.background || bg;
        fg = theme.foreground || fg;
        accent = theme.accent || accent;
        orange = theme.color1 || orange;
        gold = theme.color3 || gold;
        teal = theme.color4 || teal;
        grey = theme.color8 || grey;
    }
}
