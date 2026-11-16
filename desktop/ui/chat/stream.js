// The assistant's live events (GET /api/assistant/stream, Server-Sent Events) read with fetch, since an
// EventSource can't send the bearer token. Reconnects with a growing pause; onOpen lets the page take a fresh
// snapshot, because the stream doesn't replay history.
import { api } from '../api.js';

export function openStream({ onEvent, onOpen, onDown }) {
  let stopped = false;
  let ctrl = null;
  let wait = 1000;

  async function run() {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await api.request('GET', '/api/assistant/stream', null, { raw: true, quiet: true, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        wait = 1000;
        onOpen?.();
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let name = 'message', data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) continue; // ": ping"
              if (line.startsWith('event:')) name = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trimStart();
            }
            if (!data) continue;
            try { onEvent(name, JSON.parse(data)); } catch (e) { console.error('stream event', e); }
          }
        }
      } catch (e) {
        if (stopped || e.name === 'AbortError') return;
      }
      if (stopped) return;
      onDown?.();
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 15000);
    }
  }
  run();
  return { close() { stopped = true; ctrl?.abort(); } };
}
