const { createClient } = supabase;
const _sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let _user = null;
let _currentConv = null;
let _secretKey = null;
let _ttlInterval = null;
let _realtimeChannel = null;

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

// ============ AUTH ============
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const { error } = await _sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) authError.textContent = error.message;
});

_sb.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    _user = session.user;
    authScreen.classList.add('hidden');
    chatWindow.classList.remove('hidden');
    initChat().catch(err => {
      console.error(err);
      authError.textContent = err.message;
    });
  } else {
    cleanup();
    _user = null;
    chatWindow.classList.add('hidden');
    authScreen.classList.remove('hidden');
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
  if (_realtimeChannel) _realtimeChannel.unsubscribe();
  _realtimeChannel = _sb
    .channel(`chat:${convId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
      async (payload) => { await renderMessage(payload.new); scrollToBottom(); }
    )
    .subscribe();
}

async function renderMessage(msg) {
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
  if (!text || !_currentConv || !_secretKey) return;
  const { encrypted, iv } = await encrypt(text);
  const { error } = await _sb.from('messages').insert({
    conversation_id: _currentConv.id,
    sender_id: _user.id,
    encrypted_content: encrypted,
    iv
  });
  if (error) { console.error(error); return; }
  messageInput.value = '';
}

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
  clearInterval(_ttlInterval);
  _ttlInterval = null;
}

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
}
