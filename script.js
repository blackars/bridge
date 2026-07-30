// ============================================
// PRIVATE E2EE CHAT — Hyper-minimalista
// Vanilla JS + Supabase + Web Crypto API
 // ============================================

const { createClient } = supabase;
const _sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// --- state ---
let _user = null;
let _currentConv = null;
let _secretKey = null; // CryptoKey derived from shared secret
let _convSecret = ''; // raw shared secret for current conv
let _ttlInterval = null;
let _realtimeChannel = null;

// --- DOM refs ---
const $ = id => document.getElementById(id);
const authScreen = $('auth-screen');
const authForm = $('auth-form');
const authBtn = $('auth-btn');
const authError = $('auth-error');
const emailInput = $('email');
const passwordInput = $('password');
const bubble = $('chat-bubble');
const chatWindow = $('chat-window');
const closeChat = $('close-chat-btn');
const conversationsList = $('conversations-list');
const newPartnerEmail = $('new-partner-email');
const newSecret = $('new-secret');
const startConvBtn = $('start-conversation-btn');
const messagesPanel = $('messages-panel');
const backBtn = $('back-btn');
const messagesPartner = $('messages-partner');
const messagesList = $('messages-list');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const userEmailDisplay = $('user-email-display');
const logoutBtn = $('logout-btn');
const chatTtl = $('chat-ttl');
const chatTitle = $('chat-title');

// ============================================
// AUTH — solo login (cuentas creadas manualmente)
 // ============================================
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  try {
    const { error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    authError.textContent = err.message;
  }
});

_sb.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    _user = session.user;
    authScreen.classList.add('hidden');
    bubble.classList.remove('hidden');
    userEmailDisplay.textContent = _user.email;
    loadConversations();
  } else {
    _user = null;
    _currentConv = null;
    _secretKey = null;
    authScreen.classList.remove('hidden');
    bubble.classList.add('hidden');
    chatWindow.classList.add('hidden');
    messagesPanel.classList.add('hidden');
    if (_realtimeChannel) _realtimeChannel.unsubscribe();
    if (_ttlInterval) clearInterval(_ttlInterval);
  }
});

logoutBtn.addEventListener('click', () => _sb.auth.signOut());

// ============================================
// UI: BUBBLE / WINDOW
 // ============================================
bubble.addEventListener('click', () => {
  chatWindow.classList.toggle('hidden');
});

closeChat.addEventListener('click', () => {
  chatWindow.classList.add('hidden');
});

// ============================================
// CONVERSATIONS
 // ============================================
async function loadConversations() {
  if (!_user) return;
  const { data, error } = await _sb
    .from('conversations')
    .select('*')
    .or(`user1_id.eq.${_user.id},user2_email.eq.${_user.email}`)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  renderConversations(data || []);
}

function renderConversations(convs) {
  conversationsList.innerHTML = '';
  for (const c of convs) {
    const div = document.createElement('div');
    div.className = 'conversation-item';

    const partner = c.user1_id === _user.id ? c.user2_email : _user.email;
    div.innerHTML = `<div class="partner">${escapeHtml(partner)}</div>`;

    const now = new Date();
    const expires = new Date(c.expires_at);
    const msLeft = expires - now;

    if (msLeft <= 0) {
      div.innerHTML += `<div class="ttl-expired">expired</div>`;
    } else {
      const h = Math.floor(msLeft / 3600000);
      const m = Math.floor((msLeft % 3600000) / 60000);
      div.innerHTML += `<div class="meta">${h}h ${m}m remaining</div>`;
      div.dataset.convId = c.id;
      div.dataset.partner = partner;
      div.dataset.expiresAt = c.expires_at;
      div.addEventListener('click', () => openConversation(c.id, partner, c.expires_at));
    }

    conversationsList.appendChild(div);
  }
}

startConvBtn.addEventListener('click', async () => {
  const partnerEmail = newPartnerEmail.value.trim();
  const secret = newSecret.value;
  if (!partnerEmail || !secret) return;
  if (partnerEmail === _user.email) { alert('cannot chat with yourself'); return; }

  const { error } = await _sb
    .from('conversations')
    .insert({ user1_id: _user.id, user2_email: partnerEmail });

  if (error) {
    if (error.code === '23505') alert('conversation already exists');
    else alert(error.message);
    return;
  }

  newPartnerEmail.value = '';
  newSecret.value = '';
  // store secret for this conversation
  localStorage.setItem(`conv_secret_${_user.id}_${partnerEmail}`, secret);
  loadConversations();
});

// ============================================
// MESSAGES
 // ============================================
async function openConversation(convId, partner, expiresAt) {
  _currentConv = { id: convId, partner, expiresAt };
  messagesPanel.classList.remove('hidden');
  messagesPartner.textContent = partner;

  // get shared secret from localStorage
  const key = `conv_secret_${_user.id}_${partner}`;
  let secret = localStorage.getItem(key);
  if (!secret) {
    // Try reverse key (other user's perspective)
    const revKey = `conv_secret_${_user.id}_${_user.email}`;
    secret = localStorage.getItem(revKey);
  }
  if (!secret) {
    secret = prompt('enter shared secret for this conversation:');
    if (!secret) { closeMessages(); return; }
    localStorage.setItem(key, secret);
  }
  _convSecret = secret;
  _secretKey = await deriveKey(secret, convId);

  // start TTL countdown
  updateTtl(expiresAt);
  if (_ttlInterval) clearInterval(_ttlInterval);
  _ttlInterval = setInterval(() => updateTtl(expiresAt), 10000);

  // load existing messages
  await loadMessages(convId);

  // subscribe to new messages
  subscribeRealtime(convId);

  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
}

async function loadMessages(convId) {
  messagesList.innerHTML = '';
  const { data, error } = await _sb
    .from('messages')
    .select('*')
    .eq('conversation_id', convId)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString())
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }
  for (const msg of (data || [])) {
    await renderMessage(msg);
  }
  scrollToBottom();
}

function subscribeRealtime(convId) {
  if (_realtimeChannel) _realtimeChannel.unsubscribe();
  _realtimeChannel = _sb
    .channel(`messages:${convId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
      async (payload) => {
        await renderMessage(payload.new);
        scrollToBottom();
      }
    )
    .subscribe();
}

async function renderMessage(msg) {
  const div = document.createElement('div');
  const isOwn = msg.sender_id === _user.id;
  div.className = `msg ${isOwn ? 'own' : 'other'}`;

  try {
    const decrypted = await decrypt(msg.encrypted_content, msg.iv);
    div.textContent = decrypted;
  } catch {
    div.textContent = '🔒 cannot decrypt';
  }

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.appendChild(time);
  messagesList.appendChild(div);
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !_currentConv || !_secretKey) return;

  const { encrypted, iv } = await encrypt(text);
  const { error } = await _sb
    .from('messages')
    .insert({
      conversation_id: _currentConv.id,
      sender_id: _user.id,
      encrypted_content: encrypted,
      iv: iv
    });

  if (error) { alert(error.message); return; }
  messageInput.value = '';
}

function closeMessages() {
  messagesPanel.classList.add('hidden');
  _currentConv = null;
  _secretKey = null;
  _convSecret = '';
  messageInput.disabled = true;
  sendBtn.disabled = true;
  if (_realtimeChannel) { _realtimeChannel.unsubscribe(); _realtimeChannel = null; }
  if (_ttlInterval) { clearInterval(_ttlInterval); _ttlInterval = null; }
}

backBtn.addEventListener('click', () => {
  closeMessages();
  loadConversations();
});

// ============================================
// TTL
 // ============================================
function updateTtl(expiresAt) {
  const now = new Date();
  const expires = new Date(expiresAt);
  const msLeft = expires - now;
  if (msLeft <= 0) {
    chatTtl.textContent = 'expired';
    closeMessages();
    loadConversations();
    return;
  }
  const h = Math.floor(msLeft / 3600000);
  const m = Math.floor((msLeft % 3600000) / 60000);
  const s = Math.floor((msLeft % 60000) / 1000);
  chatTtl.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// ============================================
// E2EE — Web Crypto API
 // ============================================
async function deriveKey(secret, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt.slice(0, 16)), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    _secretKey,
    encoded
  );
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

async function decrypt(encryptedB64, ivB64) {
  const encrypted = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    _secretKey,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

// ============================================
// HELPERS
 // ============================================
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}
