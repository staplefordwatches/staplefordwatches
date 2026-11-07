const $ = id => document.getElementById(id);
const API = '/api/dispatch';
let enabled = false;
let preview = null;
let busy = false;

function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
}

function sendingControls() {
  for (const input of $('dispatch-form').querySelectorAll('input')) input.disabled = busy;
  $('logout').disabled = busy;
  $('refresh-history').disabled = busy;
  $('send-button').disabled = busy || !preview || !enabled || !$('confirmed-dispatched').checked;
  $('test-button').disabled = busy || !preview;
  $('preview-button').disabled = busy;
  $('confirmed-dispatched').disabled = busy;
}

function invalidate() {
  preview = null;
  $('confirmed-dispatched').checked = false;
  $('email-preview').hidden = true;
  $('empty-preview').hidden = false;
  $('preview-frame').srcdoc = '';
  sendingControls();
}

function signedOut() {
  invalidate();
  $('dispatch-form').reset();
  $('history-records').replaceChildren();
  $('workspace').hidden = true;
  $('login-panel').hidden = false;
  $('logout').hidden = true;
}

async function api(action, extra = {}) {
  const options = action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) } : {};
  const response = await fetch(API, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json();
  if (response.status === 401 && action !== 'login') signedOut();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not complete this request.');
  return result;
}

async function history() {
  try {
    const response = await fetch(`${API}?history=1`, { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) { signedOut(); return; }
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load the history.');
    const entries = result.records.map(record => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';
      const details = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = `${record.order_number} · ${record.watch_name}`;
      const customer = document.createElement('p');
      customer.textContent = `${record.customer_name} · ${record.customer_email}`;
      const tracking = document.createElement('p');
      tracking.className = 'history-meta';
      tracking.textContent = `Tracking: ${record.tracking_number}`;
      details.append(title, customer, tracking);
      const state = document.createElement('div');
      state.className = 'history-state';
      const label = document.createElement('div');
      label.textContent = { accepted: 'Accepted by IONOS', sending: 'Submission in progress — check before resending', uncertain: 'Needs checking — do not resend', failed: 'Not accepted — check settings' }[record.status] || record.status;
      const date = document.createElement('p');
      date.className = 'history-meta';
      date.textContent = new Date(record.updated_at).toLocaleString('en-GB');
      state.append(label, date);
      entry.append(details, state);
      return entry;
    });
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No submissions yet.';
      entries.push(empty);
    }
    $('history-records').replaceChildren(...entries);
  } catch (error) { status(error.message, true); }
}

function signedIn(result) {
  enabled = result.enabled;
  $('workspace').hidden = false;
  $('login-panel').hidden = true;
  $('logout').hidden = false;
  $('mode').textContent = enabled ? `Sending from ${result.sender}.` : `Test mode: only “Send test to Ben” is available. Customer sending is disabled.`;
  status();
  sendingControls();
  history();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  status('Signing in…');
  try { signedIn(await api('login', { accessKey: $('access-key').value })); }
  catch (error) { status(error.message, true); }
  finally { $('access-key').value = ''; button.disabled = false; }
});

$('logout').addEventListener('click', async () => {
  try { await api('logout'); signedOut(); status('Signed out.'); }
  catch (error) { status(error.message, true); }
});

$('dispatch-form').addEventListener('input', () => { invalidate(); status(); });
$('confirmed-dispatched').addEventListener('change', sendingControls);
$('dispatch-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  busy = true;
  invalidate();
  status('Preparing your preview…');
  try {
    const result = await api('preview', { data });
    preview = { data, token: result.previewToken };
    $('preview-to').textContent = result.to;
    $('preview-subject').textContent = result.subject;
    $('preview-host').textContent = result.trackingHost;
    $('preview-host').href = result.trackingUrl;
    $('preview-frame').srcdoc = result.html;
    $('email-preview').hidden = false;
    $('empty-preview').hidden = true;
    status('Check the customer, order and tracking details before sending.');
  } catch (error) { status(error.message, true); }
  finally { busy = false; sendingControls(); }
});

async function send(testOnly) {
  if (!preview || busy) return;
  const current = preview;
  busy = true;
  sendingControls();
  status(testOnly ? 'Submitting a test to Ben…' : 'Submitting the dispatch email…');
  try {
    const result = await api(testOnly ? 'send-test' : 'send', { data: current.data, previewToken: current.token, confirmedDispatched: $('confirmed-dispatched').checked });
    if (!testOnly) invalidate();
    status(`${result.message}\n${testOnly ? 'Test recipient' : 'Recipient'}: ${result.to}`);
  } catch (error) {
    // Always require a fresh preview after a failed request. Server records
    // enforce the duplicate block even if a request's response was lost.
    invalidate();
    status(`${error.message}\nCheck the submission history before attempting a resend.`, true);
  } finally {
    busy = false;
    sendingControls();
    await history();
  }
}

$('send-button').addEventListener('click', () => send(false));
$('test-button').addEventListener('click', () => send(true));
$('refresh-history').addEventListener('click', history);
api().then(signedIn).catch(error => {
  signedOut();
  if (error.message !== 'Please sign in.') status(error.message, true);
});
