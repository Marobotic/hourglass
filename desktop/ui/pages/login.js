// Signed out, this is the whole window: sign in, create an account (the Jukebox account, one for both), or get
// a reset link (LoginPage.qml).
import { h, logo } from '../dom.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  mount(root, ctx) {
    const { api, state, kit } = ctx;
    let creating = state.dev.get('login') === 'create';
    let forgot = state.dev.get('login') === 'forgot';
    let busy = false;

    const email = kit.field({ type: 'email', placeholder: 'you@example.com', onenter: () => (forgot ? submit() : password.focus()) });
    // Filled in once, never bound: a refresh must not put the saved email back over what is being typed.
    email.value = state.app.account?.email || '';
    const password = kit.field({ type: 'password', onenter: () => (creating ? confirm.focus() : submit()) });
    const confirm = kit.field({ type: 'password', onenter: () => submit() });
    const errorEl = h('div', { class: 'login-error', role: 'alert' });
    const noticeEl = h('div', { class: 'login-notice' });
    const submitBtn = kit.btn('Sign in', () => submit(), { kind: 'primary', big: true, cls: 'login-submit' });
    const modeSeg = kit.seg([{ label: 'Sign in', value: false }, { label: 'Create account', value: true }], creating, (v) => setMode(v, false), { cls: 'login-seg' });
    const forgotText = h('p', { class: 'login-forgot-text', text: "Forgot your password? Enter your email and we'll send you a link to choose a new one." });
    const pwLabel = kit.labeled('Password', password);
    const confirmLabel = kit.labeled('Confirm password', confirm);
    const forgotLink = h('button', { class: 'link', type: 'button', onclick: () => setMode(false, !forgot) });

    function setMode(create, lost) {
      creating = create; forgot = lost;
      errorEl.textContent = ''; noticeEl.textContent = '';
      paint();
      (forgot || !email.value ? email : password).focus();
    }
    function paint() {
      modeSeg.hidden = forgot;
      modeSeg.set(creating);
      forgotText.hidden = !forgot;
      pwLabel.hidden = forgot;
      confirmLabel.hidden = !creating || forgot;
      submitBtn.querySelector('.lbl').textContent = busy ? 'One moment…' : forgot ? 'Send reset link' : creating ? 'Create account' : 'Sign in';
      submitBtn.disabled = busy;
      forgotLink.textContent = forgot ? '‹ Back to sign in' : 'Forgot password?';
      forgotLink.hidden = creating && !forgot;
      noticeEl.hidden = !noticeEl.textContent;
      errorEl.hidden = !errorEl.textContent;
    }
    // Checked here first, so the common mistakes never make a round trip.
    async function submit() {
      if (busy) return;
      const e = email.value.trim();
      noticeEl.textContent = '';
      let err = !EMAIL.test(e) ? 'Enter a valid email address.' : '';
      if (!forgot && !err) err = password.value.length < 8 ? 'The password needs at least 8 characters.' : creating && confirm.value !== password.value ? 'The passwords do not match.' : '';
      errorEl.textContent = err;
      if (err) { paint(); return; }
      busy = true; paint();
      try {
        if (forgot) {
          await api.post('/api/account/forgot', { email: e }, { readOnly: true, quiet: true });
          noticeEl.textContent = `If ${e} has an account, a reset link is on its way. Open it on any device; it works for one hour.`;
        } else {
          await api.post(creating ? '/api/account/register' : '/api/account/login', { email: e, password: password.value }, { quiet: true });
          password.value = ''; confirm.value = '';
          ctx.pollState();
        }
      } catch (x) { errorEl.textContent = x.message; }
      busy = false; paint();
    }

    if (state.app.account?.session_ended) noticeEl.textContent = state.app.account.session_ended;
    root.append(h('div', { class: 'login' },
      logo(7, { alive: true }),
      h('h1', { text: 'Hourglass' }),
      h('p', { class: 'muted', text: 'Your schedule and notes, on every device.' }),
      h('form', { class: 'card login-card', onsubmit: (e) => { e.preventDefault(); submit(); } },
        modeSeg, forgotText, kit.labeled('Email', email), pwLabel, confirmLabel, errorEl, noticeEl, submitBtn, forgotLink)));
    paint();
    queueMicrotask(() => (email.value ? password : email).focus());
    return {};
  },
};
