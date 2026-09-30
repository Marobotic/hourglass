pragma Singleton
import QtQuick

QtObject {
    readonly property var weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    readonly property var weekdaysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    readonly property var months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    readonly property var kinds: ["lecture", "lab", "tutorial", "exam", "event"]
    readonly property var palette: ["#B14242", "#D66E36", "#F0BE66", "#4A8B8B", "#7E6BAF", "#5B8C4A", "#C2587E", "#8A8A8A"]

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    // "YYYY-MM-DD" helpers on UTC midnights (no DST drift)
    function parse(d) { const p = d.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function fmt(ms) { const d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
    function addDays(d, n) { return fmt(parse(d) + n * 86400000); }
    function isoWeekday(d) { return ((new Date(parse(d)).getUTCDay() + 6) % 7) + 1; }
    function weekStart(d) { return addDays(d, 1 - isoWeekday(d)); }
    function dayNum(d) { return new Date(parse(d)).getUTCDate(); }
    function monthName(d) { return months[new Date(parse(d)).getUTCMonth()]; }
    function short(d) { return weekdays[isoWeekday(d) - 1] + " " + dayNum(d) + " " + monthName(d).slice(0, 3); }
    function long(d) { return weekdaysLong[isoWeekday(d) - 1] + ", " + dayNum(d) + " " + monthName(d); }
    function minutes(t) { const p = t.split(":"); return +p[0] * 60 + +p[1]; }
    function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
    function isTime(s) { return /^\d{1,2}:\d{2}$/.test(s) && +s.split(":")[0] < 24 && +s.split(":")[1] < 60; }

    // Offset of the Hourglass time zone from UTC, sent by the sidecar. Wall-clock
    // helpers use it instead of the system zone.
    property int offsetMin: -new Date().getTimezoneOffset()
    function wall(ms) { return new Date(ms + offsetMin * 60000); } // read with getUTC*
    function clock(ms) { const d = wall(ms); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
    function dayOf(ms) { return fmt(Date.UTC(wall(ms).getUTCFullYear(), wall(ms).getUTCMonth(), wall(ms).getUTCDate())); }
    function minutesOf(ms) { const d = wall(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

    function countdown(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
        return (h ? h + ":" + pad(m) : m) + ":" + pad(s);
    }

    // "in 18 min", "in 3 h 5 min", "in 2 d"
    function relative(min) {
        if (min < 1) return "now";
        if (min < 60) return "in " + min + " min";
        if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return "in " + h + " h" + (m ? " " + m + " min" : ""); }
        const d = Math.round(min / 1440);
        return "in " + d + (d === 1 ? " day" : " days");
    }

    function left(min) {
        if (min < 60) return min + " min left";
        const h = Math.floor(min / 60), m = min % 60;
        return h + " h" + (m ? " " + m + " min" : "") + " left";
    }

    function repeatText(ev) {
        const r = ev.repeat;
        if (!r) return "Once, " + short(ev.start_date);
        let s = r.freq === "daily" ? (r.interval > 1 ? "Every " + r.interval + " days" : "Daily")
            : (r.interval > 1 ? "Every " + r.interval + " weeks on " : "Every ") + (r.days || [isoWeekday(ev.start_date)]).map(d => weekdays[d - 1]).join(", ");
        if (r.until) s += " until " + short(r.until);
        return s;
    }

    function kindLabel(k) { return k ? k.charAt(0).toUpperCase() + k.slice(1) : ""; }

    function preview(body) {
        return (body || "").replace(/[#>*_`\-\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
    }
}
