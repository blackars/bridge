const { createClient } = supabase;
const _sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false }
});

let _user = null;
let _currentConv = null;
let _secretKey = null;
let _ttlInterval = null;
let _realtimeChannel = null;
let _renderedIds = new Set();
let _sending = false;
let _typingChannel = null;
let _typingTimeout = null;
let _typingSent = false;
let _reconnectTimers = {};
let _reconnectAttempts = 0;
let _healthInterval = null;
let _lastMsgAt = null;

const $ = id => document.getElementById(id);
const authScreen = $('auth-screen');
const authForm = $('auth-form');
const authError = $('auth-error');
const emailInput = $('email');
const passwordInput = $('password');
const chatWindow = $('chat-window');
const closeChat = $('close-chat-btn');
const messagesList = $('messages-list');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const chatTtl = $('chat-ttl');
const chatError = $('chat-error');
const typingIndicator = $('typing-indicator');
const scrollBottomBtn = $('scroll-bottom-btn');
const rtStatusDot = $('rt-status');

// ============ AUTH ============
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authForm.querySelector('button').disabled = true;
  const { error } = await _sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) {
    authError.textContent = error.message;
    authForm.querySelector('button').disabled = false;
  }
});

let _initLock = false;
_sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    if (_initLock) return;
    _initLock = true;
    _user = session.user;
    authError.textContent = 'loading...';
    try {
      await initChat();
      authScreen.classList.add('hidden');
      chatWindow.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      authError.textContent = '✗ ' + err.message;
      authForm.querySelector('button').disabled = false;
      _user = null;
      _initLock = false;
    }
  } else {
    cleanup();
    _user = null;
    _initLock = false;
    chatWindow.classList.add('hidden');
    authScreen.classList.remove('hidden');
    authError.textContent = '';
    authForm.querySelector('button').disabled = false;
  }
});

closeChat.addEventListener('click', () => _sb.auth.signOut());

// ============ CHAT ============
async function initChat() {
  const partner = await getPartner();
  if (!partner) throw new Error('other user not found in profiles');

  const conv = await findOrCreateConv(partner);
  if (!conv) throw new Error('could not create conversation');

  _currentConv = { id: conv.id, partner };
  _secretKey = await deriveKey(CHAT_SECRET, conv.id);

  updateTtl(conv.expires_at);
  clearInterval(_ttlInterval);
  _ttlInterval = setInterval(() => updateTtl(conv.expires_at), 10000);

  await loadMessages(conv.id);
  subscribeRealtime(conv.id);
  subscribeTyping(conv.id);
  startHealthCheck();

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
}

async function getPartner() {
  const { data, error } = await _sb
    .from('profiles')
    .select('email')
    .neq('id', _user.id)
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return data[0].email;
  return null;
}

async function findOrCreateConv(partnerEmail) {
  const { data: existing } = await _sb
    .from('conversations')
    .select('*')
    .or(`user1_id.eq.${_user.id},user2_email.eq.${_user.email}`)
    .limit(1);

  if (existing && existing.length > 0) return existing[0];

  const { data: created, error } = await _sb
    .from('conversations')
    .insert({ user1_id: _user.id, user2_email: partnerEmail })
    .select()
    .single();

  if (error) throw error;
  return created;
}

async function loadMessages(convId) {
  messagesList.innerHTML = '';
  messagesList.appendChild(typingIndicator);
  _renderedIds = new Set();
  _lastMsgAt = null;
  const { data, error } = await _sb
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;
  for (const msg of (data || [])) await renderMessage(msg);
  scrollToBottom();
}

function subscribeRealtime(convId) {
  clearTimeout(_reconnectTimers.chat);
  _reconnectTimers.chat = null;
  if (_realtimeChannel) _realtimeChannel.unsubscribe();
  _realtimeChannel = _sb
    .channel(`chat:${convId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
      async (payload) => {
        await renderMessage(payload.new);
        showTyping(false);
        if (isAtBottom()) scrollToBottom();
        updateScrollBtn();
      }
    )
    .subscribe((status, err) => handleChannelStatus('chat', status, err));
}

function handleChannelStatus(kind, status, err) {
  if (status === 'SUBSCRIBED') {
    _reconnectAttempts = 0;
    if (kind === 'chat') {
      setRtStatus('connected');
      catchUpMessages(_currentConv && _currentConv.id);
    }
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'SUBSCRIBE_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    console.warn(`[realtime:${kind}]`, status, err && err.message);
    if (!_user || !_currentConv) return;
    if (kind === 'chat') setRtStatus('reconnecting');
    const delay = 1000 * Math.pow(2, Math.min(_reconnectAttempts, 3));
    _reconnectAttempts++;
    clearTimeout(_reconnectTimers[kind]);
    _reconnectTimers[kind] = setTimeout(async () => {
      _reconnectTimers[kind] = null;
      if (!_user || !_currentConv) return;
      await refreshSessionIfNeeded();
      if (kind === 'chat') subscribeRealtime(_currentConv.id);
      else subscribeTyping(_currentConv.id);
    }, delay);
  }
}

async function refreshSessionIfNeeded() {
  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session || Date.now() / 1000 >= session.expires_at - 60) {
      await _sb.auth.refreshSession();
    }
  } catch (err) {
    console.warn('[realtime] refresh failed', err);
  }
}

async function catchUpMessages(convId) {
  if (!convId || !_lastMsgAt) return;
  const { data, error } = await _sb
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .gte('created_at', _lastMsgAt.toISOString())
    .order('created_at', { ascending: true });
  if (error || !data || data.length === 0) return;
  for (const msg of data) await renderMessage(msg);
  if (isAtBottom()) scrollToBottom();
  updateScrollBtn();
}

function setRtStatus(state) {
  if (!rtStatusDot) return;
  rtStatusDot.className = `rt-status ${state}`;
  rtStatusDot.title = state === 'connected' ? 'conectado'
    : state === 'reconnecting' ? 'reconectando…' : 'sin conexión';
}

function startHealthCheck() {
  clearInterval(_healthInterval);
  _healthInterval = setInterval(() => {
    if (!_user || !_currentConv) return;
    const chatOk = _realtimeChannel && _realtimeChannel.state === 'joined';
    const typingOk = _typingChannel && _typingChannel.state === 'joined';
    if (!chatOk) subscribeRealtime(_currentConv.id);
    if (!typingOk) subscribeTyping(_currentConv.id);
  }, 30000);
}

async function renderMessage(msg) {
  if (msg.id && _renderedIds.has(msg.id)) return;
  if (msg.id) _renderedIds.add(msg.id);
  if (msg.created_at) {
    const t = new Date(msg.created_at);
    if (!_lastMsgAt || t > _lastMsgAt) _lastMsgAt = t;
  }
  const div = document.createElement('div');
  div.className = `msg ${msg.sender_id === _user.id ? 'own' : 'other'}`;
  try {
    div.textContent = await decrypt(msg.encrypted_content, msg.iv);
  } catch {
    div.textContent = '🔒';
  }
  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.appendChild(time);
  messagesList.appendChild(div);
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || _sending) return;
  _sending = true;
  try {
    if (!_currentConv || !_secretKey) {
      try {
        await initChat();
      } catch (err) {
        console.error(err);
        showChatError(err.message);
        return;
      }
    }
    const { encrypted, iv } = await encrypt(text);
    const { data: inserted, error } = await _sb
      .from('messages')
      .insert({
        conversation_id: _currentConv.id,
        sender_id: _user.id,
        encrypted_content: encrypted,
        iv
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      showChatError(error.message);
      return;
    }
    chatError.classList.add('hidden');
    messageInput.value = '';
    await renderMessage(inserted);
    scrollToBottom();
  } finally {
    _sending = false;
  }
}

function showChatError(msg) {
  chatError.textContent = '✗ ' + msg;
  chatError.classList.remove('hidden');
}

// ============ TYPING INDICATOR ============
function subscribeTyping(convId) {
  clearTimeout(_reconnectTimers.typing);
  _reconnectTimers.typing = null;
  if (_typingChannel) _typingChannel.unsubscribe();
  _typingChannel = _sb.channel(`typing:${convId}`, { config: { private: true } });
  _typingChannel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId === _user.id) return;
      showTyping(!!payload.typing);
    })
    .subscribe((status, err) => handleChannelStatus('typing', status, err));
}

function sendTyping(typing) {
  if (!_typingChannel || _typingSent === typing) return;
  _typingSent = typing;
  _typingChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { typing, userId: _user.id }
  });
}

function showTyping(visible) {
  typingIndicator.classList.toggle('hidden', !visible);
  if (visible && isAtBottom()) scrollToBottom();
}

messageInput.addEventListener('input', () => {
  sendTyping(true);
  clearTimeout(_typingTimeout);
  _typingTimeout = setTimeout(() => sendTyping(false), 1500);
});
messageInput.addEventListener('blur', () => {
  clearTimeout(_typingTimeout);
  sendTyping(false);
});

// ============ TTL ============
function updateTtl(expiresAt) {
  const ms = new Date(expiresAt) - new Date();
  if (ms <= 0) { chatTtl.textContent = 'expired'; return; }
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  chatTtl.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

function cleanup() {
  _currentConv = null;
  _secretKey = null;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  if (_realtimeChannel) { _realtimeChannel.unsubscribe(); _realtimeChannel = null; }
  clearTimeout(_typingTimeout);
  _typingTimeout = null;
  _typingSent = false;
  if (_typingChannel) { _typingChannel.unsubscribe(); _typingChannel = null; }
  showTyping(false);
  clearInterval(_ttlInterval);
  _ttlInterval = null;
  clearInterval(_healthInterval);
  _healthInterval = null;
  clearTimeout(_reconnectTimers.chat);
  clearTimeout(_reconnectTimers.typing);
  _reconnectTimers = {};
  _reconnectAttempts = 0;
  _lastMsgAt = null;
  setRtStatus('offline');
}

document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !_user || !_currentConv) return;
  await refreshSessionIfNeeded();
  const chatOk = _realtimeChannel && _realtimeChannel.state === 'joined';
  const typingOk = _typingChannel && _typingChannel.state === 'joined';
  if (!chatOk) subscribeRealtime(_currentConv.id);
  if (!typingOk) subscribeTyping(_currentConv.id);
  await catchUpMessages(_currentConv.id);
});

window.addEventListener('online', () => {
  if (!_user || !_currentConv) return;
  subscribeRealtime(_currentConv.id);
  subscribeTyping(_currentConv.id);
});

// ============ E2EE ============
async function deriveKey(secret, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt.slice(0, 16)), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _secretKey, new TextEncoder().encode(text));
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

async function decrypt(encryptedB64, ivB64) {
  const encrypted = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _secretKey, encrypted);
  return new TextDecoder().decode(decrypted);
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
  updateScrollBtn();
}

// ============ SCROLL TO BOTTOM BUTTON ============
function isAtBottom() {
  return messagesList.scrollHeight - messagesList.scrollTop - messagesList.clientHeight < 80;
}

function updateScrollBtn() {
  scrollBottomBtn.classList.toggle('hidden', isAtBottom());
}

messagesList.addEventListener('scroll', updateScrollBtn);
scrollBottomBtn.addEventListener('click', () => {
  messagesList.scrollTo({ top: messagesList.scrollHeight, behavior: 'smooth' });
});
