// A canned conversation for screenshots (?fakechat): the transcript's look without a server or an account.
export function fakeChat(now = Date.now()) {
  const t = (s) => now - s * 1000;
  return {
    enabled: true, busy: true, state: 'busy', engine: 'anthropic', engine_name: 'Anthropic', model: 'claude-haiku-5-5', effort: 'medium', mode: 'auto',
    queue: [{ id: 'q1', at: t(5), text: 'and remind me 15 minutes before it', files: 0 }],
    messages: [
      { id: 'u1', role: 'user', time: t(60), text: 'Wake me at 7:30 on weekdays, and move my Thursday lab to 2 PM', files: [], tools: [], cards: [] },
      { id: 'a1', role: 'assistant', time: t(58), model: 'claude-haiku-5-5', text: 'Done. Your alarm rings at **7:30 every weekday**, and the Physics lab now starts at 2 PM.\n\n| Day | Before | After |\n|---|---|---|\n| Thu | 10:00 | 14:00 |',
        steps: [{ at: t(58), text: 'Thinking: the user wants an alarm on weekdays' }, { at: t(54), text: 'Thinking: find the Thursday lab' }],
        tools: [
          { call_id: 't1', tool: 'set_alarm', label: 'Set an alarm', status: 'completed', input: '{"label":"Wake up","time":"07:30","days":[1,2,3,4,5]}', output: '{"id":"al_1"}', duration_ms: 14 },
          { call_id: 't2', tool: 'get_schedule', label: 'Read your schedule', status: 'completed', input: '{"from":"2026-11-16","to":"2026-11-22"}', output: '{"occurrences":9}', duration_ms: 31 },
          { call_id: 't3', tool: 'update_event', label: 'Moved an event', status: 'completed', input: '{"title":"Physics lab","start":"14:00"}', output: '{"ok":true}', duration_ms: 22 },
        ],
        cards: [{ kind: 'alarm', state: 'set', label: 'Wake up', time: '7:30 AM', when: 'Mon–Fri' }, { kind: 'event', state: 'changed', label: 'Physics lab', time: '2:00 PM', when: 'Thu 19 Nov' }],
        usage: { input_tokens: 11800, output_tokens: 240, cache_read_input_tokens: 900, cost: 0.0031, context_percent: 6.4 }, pending_actions: [] },
      { id: 'u2', role: 'user', time: t(20), text: 'Tidy up my Algorithms note from today', files: [], tools: [], cards: [] },
      { id: 'a2', role: 'assistant', time: t(18), model: 'claude-haiku-5-5', text: '', steps: [],
        tools: [
          { call_id: 't4', tool: 'get_notes', label: 'Read your notes', status: 'completed', input: '{"course":"Algorithms","date":"2026-11-15"}', output: '[…]', duration_ms: 18 },
          { call_id: 't5', tool: 'update_note', label: 'Editing a note', status: 'running', input: '{"title":"Dynamic programming"}', output: '' },
        ], cards: [], pending_actions: [], usage: { input_tokens: 12400, output_tokens: 80 } },
    ],
  };
}
