import { createHash } from "node:crypto";

// One snooze timer per ring, whichever device snoozes it: the id comes from the
// alarm and the occurrence ringing (a name-based UUID v3, the same as Java's
// UUID.nameUUIDFromBytes and the iPhone's nameUUID), so every device makes the
// same timer row instead of three. A dismissed occurrence cancels this id.
export function snoozeTimerId(alarmId, at) {
  const b = createHash("md5").update(`snooze:${alarmId}:${at}`).digest();
  b[6] = (b[6] & 0x0f) | 0x30; // version 3
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Shared ring requests keep the Windows and Linux sidecars on the same protocol.
export function createRingClient({ server, token, device }) {
  const headers = () => ({ authorization: `Bearer ${token()}`, "content-type": "application/json", "x-hourglass-device": device() });
  const url = (path, id, at) => `${server()}/api/ring/${path}?alarm_id=${encodeURIComponent(id)}&at=${encodeURIComponent(at)}`;
  async function state(item) {
    const r = await fetch(url("state", item.id, item.at), { headers: headers(), signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(`ring state ${r.status}`);
    return (await r.json()).stopped;
  }
  function stop(item, action) {
    fetch(`${server()}/api/ring/stop`, { method: "POST", headers: headers(), body: JSON.stringify({ alarm_id: item.id, at: item.at, action, device: device() }), signal: AbortSignal.timeout(2000) }).catch(() => {});
  }
  async function watch(item, active, onStop) {
    while (active()) {
      try {
        const r = await fetch(url("watch", item.id, item.at), { headers: headers(), signal: AbortSignal.timeout(27000) });
        if (!r.ok) throw new Error(`ring watch ${r.status}`);
        const out = await r.json();
        if (out.stopped) { onStop(out.stopped); return; }
      } catch {
        if (!active()) return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
  return { state, stop, watch };
}
