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
