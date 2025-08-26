// Application Configuration
const CONFIG = {
    socketUrl: 'https://chatrizpxtback.onrender.com',  // Your backend Render URL
    encryption: {
        algorithm: 'AES-GCM',
        keyDerivation: 'PBKDF2',
        iterations: 100000,
        saltLength: 16,
        ivLength: 12
    },
    validation: {
        roomName: { minLength: 3, maxLength: 50, pattern: /^[a-zA-Z0-9\s\-_]+$/ },
        password: { minLength: 6, maxLength: 100 },
        username: { minLength: 2, maxLength: 20, pattern: /^[a-zA-Z0-9\-_]+$/ },
        roomId: { pattern: /^[a-zA-Z0-9]{8}$/ }
    },
    emojis: ['😀', '😂', '❤️', '👍', '👎', '😊', '😢', '😮', '😡', '🔥', '👋', '✨'],
    ui: {
        maxMessagesDisplay: 100,
        typingTimeout: 3000,
        reconnectAttempts: 5,
        messageMaxLength: 1000
    }
};

// Global State
let socket = null;
let currentRoom = null;
let encryptionKey = null;
let currentUser = null;
let typingTimeout = null;
let messages = [];

// DOM Elements
const elements = {
    landingPage: document.getElementById('landing-page'),
    chatInterface: document.getElementById('chat-interface'),
    roomCreatedModal: document.getElementById('room-created-modal'),
    usernameModal: document.getElementById('username-modal'),
    connectionStatus: document.getElementById('connection-status'),
    toast: document.getElementById('toast'),
    
    // Forms
    createRoomForm: document.getElementById('create-room-form'),
    joinRoomForm: document.getElementById('join-room-form'),
    usernameForm: document.getElementById('username-form'),
    
    // Inputs
    roomName: document.getElementById('room-name'),
    createPassword: document.getElementById('create-password'),
    roomId: document.getElementById('room-id'),
    joinPassword: document.getElementById('join-password'),
    username: document.getElementById('username'),
    messageInput: document.getElementById('message-input'),
    
    // Chat Interface
    currentRoomName: document.getElementById('current-room-name'),
    participantsCount: document.getElementById('participants-count'),
    messagesList: document.getElementById('messages-list'),
    typingIndicator: document.getElementById('typing-indicator'),
    typingUsers: document.getElementById('typing-users'),
    
    // Buttons
    sendBtn: document.getElementById('send-btn'),
    emojiBtn: document.getElementById('emoji-btn'),
    inviteBtn: document.getElementById('invite-btn'),
    leaveRoom: document.getElementById('leave-room'),
    proceedToRoom: document.getElementById('proceed-to-room'),
    copyRoomId: document.getElementById('copy-room-id'),
    copyInviteLink: document.getElementById('copy-invite-link'),
    
    // Other
    createdRoomId: document.getElementById('created-room-id'),
    inviteLink: document.getElementById('invite-link'),
    emojiPicker: document.getElementById('emoji-picker'),
    emojiGrid: document.getElementById('emoji-grid'),
    statusText: document.getElementById('status-text'),
    loadingSpinner: document.getElementById('loading-spinner'),
    toastMessage: document.getElementById('toast-message')
};

// Encryption Utilities
class CryptoUtils {
    static async generateSalt() {
        return crypto.getRandomValues(new Uint8Array(CONFIG.encryption.saltLength));
    }

    static async generateIV() {
        return crypto.getRandomValues(new Uint8Array(CONFIG.encryption.ivLength));
    }

    static async deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: CONFIG.encryption.iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    static async encrypt(text, key) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const iv = await this.generateIV();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        return {
            data: Array.from(new Uint8Array(encrypted)),
            iv: Array.from(iv)
        };
    }

    static async decrypt(encryptedData, key) {
        const data = new Uint8Array(encryptedData.data);
        const iv = new Uint8Array(encryptedData.iv);
        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                data
            );
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            console.error('Decryption failed:', error);
            return '[Encrypted message - unable to decrypt]';
        }
    }
}

// Validation Utilities
class Validator {
    static validateRoomName(name) {
        if (!name || name.length < CONFIG.validation.roomName.minLength) {
            return `Room name must be at least ${CONFIG.validation.roomName.minLength} characters`;
        }
        if (name.length > CONFIG.validation.roomName.maxLength) {
            return `Room name must be less than ${CONFIG.validation.roomName.maxLength} characters`;
        }
        if (!CONFIG.validation.roomName.pattern.test(name)) {
            return 'Room name can only contain letters, numbers, spaces, hyphens, and underscores';
        }
        return null;
    }

    static validatePassword(password) {
        if (!password || password.length < CONFIG.validation.password.minLength) {
            return `Password must be at least ${CONFIG.validation.password.minLength} characters`;
        }
        if (password.length > CONFIG.validation.password.maxLength) {
            return `Password must be less than ${CONFIG.validation.password.maxLength} characters`;
        }
        return null;
    }

    static validateUsername(username) {
        if (!username || username.length < CONFIG.validation.username.minLength) {
            return `Username must be at least ${CONFIG.validation.username.minLength} characters`;
        }
        if (username.length > CONFIG.validation.username.maxLength) {
            return `Username must be less than ${CONFIG.validation.username.maxLength} characters`;
        }
        if (!CONFIG.validation.username.pattern.test(username)) {
            return 'Username can only contain letters, numbers, hyphens, and underscores';
        }
        return null;
    }

    static validateRoomId(roomId) {
        if (!roomId || !CONFIG.validation.roomId.pattern.test(roomId)) {
            return 'Room ID must be 8 characters long and contain only letters and numbers';
        }
        return null;
    }
}

// UI Utilities
class UI {
    static showElement(element) {
        if (element) element.classList.remove('hidden');
    }

    static hideElement(element) {
        if (element) element.classList.add('hidden');
    }

    static showError(inputId, message) {
        const errorElement = document.getElementById(`${inputId}-error`);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    }

    static hideError(inputId) {
        const errorElement = document.getElementById(`${inputId}-error`);
        if (errorElement) {
            errorElement.classList.remove('show');
        }
    }

    static showToast(message, type = 'info') {
        elements.toastMessage.textContent = message;
        elements.toast.className = `toast ${type}`;
        this.showElement(elements.toast);
        setTimeout(() => { this.hideElement(elements.toast); }, 3000);
    }

    static updateConnectionStatus(status, message) {
        elements.statusText.textContent = message;
        elements.connectionStatus.className = `connection-status ${status}`;
        if (status === 'connecting') {
            this.showElement(elements.loadingSpinner);
        } else {
            this.hideElement(elements.loadingSpinner);
        }
        this.showElement(elements.connectionStatus);
        if (status === 'connected') {
            setTimeout(() => { this.hideElement(elements.connectionStatus); }, 2000);
        }
    }

    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied to clipboard!', 'success');
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showToast('Failed to copy to clipboard', 'error');
        }
    }
}

// Socket Connection
function initializeSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.IO not available - running in demo mode');
        UI.updateConnectionStatus('disconnected', 'Demo mode - Backend not available');
        return;
    }

    // Updated Socket.IO initialization for production/Render compatibility
    socket = io(CONFIG.socketUrl, {
        transports: ['websocket', 'polling'],  // Prefer WebSocket, fallback to polling
        secure: true,  // Enforce secure (HTTPS) connection
        reconnection: true,  // Auto-reconnect on failure
        reconnectionAttempts: CONFIG.ui.reconnectAttempts  // 5 attempts
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        UI.updateConnectionStatus('connected', 'Connected');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        UI.updateConnectionStatus('disconnected', 'Disconnected');
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error details:', error);  // Improved logging for debugging
        UI.updateConnectionStatus('disconnected', 'Backend server not running');
    });

    socket.on('room-created', (data) => {
        handleRoomCreated(data);
    });

    socket.on('joined-room', (data) => {
        handleRoomJoined(data);
    });

    socket.on('join-room-error', (error) => {
        UI.showToast(error.message, 'error');
        UI.hideElement(elements.usernameModal);
    });

    socket.on('new-message', async (data) => {
        await handleNewMessage(data);
    });

    socket.on('user-joined', (data) => {
        addSystemMessage(`${data.username} joined the room`);
        updateParticipantsCount(data.participants.length);
    });

    socket.on('user-left', (data) => {
        addSystemMessage(`${data.username} left the room`);
        updateParticipantsCount(data.participants.length);
    });

    socket.on('user-typing', (data) => {
        handleTypingIndicator(data);
    });
}

// Room Management
async function createRoom(roomName, password) {
    try {
        if (!socket || !socket.connected) {
            // Demo mode - simulate room creation
            const roomId = generateRoomId();
            handleRoomCreated({ roomId: roomId, roomName: roomName, participants: [] });
            UI.showToast('Room created in demo mode', 'success');
            return;
        }

        const salt = await CryptoUtils.generateSalt();
        encryptionKey = await CryptoUtils.deriveKey(password, salt);

        socket.emit('create-room', {
            roomName,
            password,
            salt: Array.from(salt)
        });
    } catch (error) {
        console.error('Error creating room:', error);
        UI.showToast('Failed to create room', 'error');
    }
}

async function joinRoom(roomId, password) {
    try {
        if (!socket || !socket.connected) {
            UI.showToast('Backend server not available - cannot join room', 'error');
            return;
        }

        currentRoom = { id: roomId, password };
        socket.emit('join-room', { roomId, password });
    } catch (error) {
        console.error('Error joining room:', error);
        UI.showToast('Failed to join room', 'error');
    }
}

function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function handleRoomCreated(data) {
    currentRoom = data;
    elements.createdRoomId.value = data.roomId;
    elements.inviteLink.value = `${window.location.origin}/?roomId=${data.roomId}`;
    UI.showElement(elements.roomCreatedModal);
}

async function handleRoomJoined(data) {
    try {
        const salt = new Uint8Array(data.salt);
        encryptionKey = await CryptoUtils.deriveKey(currentRoom.password, salt);
        currentRoom = { ...currentRoom, ...data };
        UI.hideElement(elements.usernameModal);
        showChatInterface();
        UI.showToast('Joined room successfully!', 'success');
    } catch (error) {
        console.error('Error setting up encryption:', error);
        UI.showToast('Failed to setup encryption', 'error');
    }
}

function showChatInterface() {
    UI.hideElement(elements.landingPage);
    UI.hideElement(elements.roomCreatedModal);
    UI.showElement(elements.chatInterface);
    elements.currentRoomName.textContent = currentRoom.roomName;
    updateParticipantsCount(currentRoom.participants.length || 1);
    elements.messageInput.focus();
}

// Message Handling
async function sendMessage() {
    const messageText = elements.messageInput.value.trim();
    if (!messageText) return;

    try {
        if (!socket || !socket.connected) {
            // Demo mode - show message locally
            addMessage(currentUser, messageText, new Date().toISOString(), true);
            elements.messageInput.value = '';
            return;
        }

        if (!encryptionKey) {
            UI.showToast('Encryption key not available', 'error');
            return;
        }

        const encryptedMessage = await CryptoUtils.encrypt(messageText, encryptionKey);
        socket.emit('send-message', {
            roomId: currentRoom.id,
            encryptedMessage,
            timestamp: new Date().toISOString()
        });

        elements.messageInput.value = '';
        stopTyping();
    } catch (error) {
        console.error('Error sending message:', error);
        UI.showToast('Failed to send message', 'error');
    }
}

async function handleNewMessage(data) {
    try {
        let messageContent;
        if (data.type === 'system') {
            messageContent = data.message;
            addSystemMessage(messageContent);
        } else {
            messageContent = await CryptoUtils.decrypt(data.encryptedMessage, encryptionKey);
            addMessage(data.username, messageContent, data.timestamp, data.username === currentUser);
        }
    } catch (error) {
        console.error('Error handling message:', error);
    }
}

function addMessage(username, content, timestamp, isOwn) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageDiv.innerHTML = `
        <div class="message__header">
            <span class="message__username">${escapeHtml(username)}</span>
            <span class="message__time">${time}</span>
        </div>
        <div class="message__content">${escapeHtml(content)}</div>
    `;
    elements.messagesList.appendChild(messageDiv);
    scrollToBottom();

    // Limit displayed messages
    if (messages.length > CONFIG.ui.maxMessagesDisplay) {
        messages.shift();
        if (elements.messagesList.firstChild) {
            elements.messagesList.removeChild(elements.messagesList.firstChild);
        }
    }
    messages.push({ username, content, timestamp, isOwn });
}

function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.innerHTML = `<div class="message__content">${escapeHtml(content)}</div>`;
    elements.messagesList.appendChild(messageDiv);
    scrollToBottom();
}

function scrollToBottom() {
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// Typing Indicators
function startTyping() {
    if (!socket || !socket.connected) return;
    if (typingTimeout) clearTimeout(typingTimeout);
    socket.emit('typing-start', { roomId: currentRoom.id });
    typingTimeout = setTimeout(stopTyping, CONFIG.ui.typingTimeout);
}

function stopTyping() {
    if (!socket || !socket.connected) return;
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
    socket.emit('typing-stop', { roomId: currentRoom.id });
}

function handleTypingIndicator(data) {
    elements.typingUsers.textContent = `${data.username} is typing...`;
    UI.showElement(elements.typingIndicator);
}

function handleStopTyping(data) {
    UI.hideElement(elements.typingIndicator);
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateParticipantsCount(count) {
    elements.participantsCount.textContent = `${count} online`;
}

function leaveRoom() {
    if (socket && socket.connected && currentRoom) {
        socket.emit('leave-room', { roomId: currentRoom.id });
    }
    // Clear sensitive data
    currentRoom = null;
    encryptionKey = null;
    currentUser = null;
    messages = [];
    // Reset UI
    elements.messagesList.innerHTML = '';
    UI.hideElement(elements.chatInterface);
    UI.hideElement(elements.roomCreatedModal);
    UI.hideElement(elements.usernameModal);
    UI.showElement(elements.landingPage);
    // Clear forms
    document.querySelectorAll('form').forEach(form => form.reset());
    document.querySelectorAll('.form-error').forEach(error => error.classList.remove('show'));
}

// Initialize Emoji Picker
function initializeEmojiPicker() {
    CONFIG.emojis.forEach(emoji => {
        const button = document.createElement('button');
        button.className = 'emoji-item';
        button.textContent = emoji;
        button.onclick = () => {
            elements.messageInput.value += emoji;
            UI.hideElement(elements.emojiPicker);
            elements.messageInput.focus();
        };
        elements.emojiGrid.appendChild(button);
    });
}

// Input validation helpers
function setupInputValidation() {
    // Real-time validation for room name
    elements.roomName.addEventListener('input', () => {
        const value = elements.roomName.value.trim();
        if (value.length >= CONFIG.validation.roomName.minLength) {
            UI.hideError('room-name');
        }
    });

    // Real-time validation for create password
    elements.createPassword.addEventListener('input', () => {
        const value = elements.createPassword.value;
        if (value.length >= CONFIG.validation.password.minLength) {
            UI.hideError('create-password');
        }
    });

    // Real-time validation for room ID
    elements.roomId.addEventListener('input', () => {
        const value = elements.roomId.value.trim();
        if (CONFIG.validation.roomId.pattern.test(value)) {
            UI.hideError('room-id');
        }
    });

    // Real-time validation for join password
    elements.joinPassword.addEventListener('input', () => {
        const value = elements.joinPassword.value;
        if (value.length >= CONFIG.validation.password.minLength) {
            UI.hideError('join-password');
        }
    });

    // Real-time validation for username
    elements.username.addEventListener('input', () => {
        const value = elements.username.value.trim();
        if (value.length >= CONFIG.validation.username.minLength && CONFIG.validation.username.pattern.test(value)) {
            UI.hideError('username');
        }
    });
}

// Event Listeners
function initializeEventListeners() {
    // Setup input validation
    setupInputValidation();

    // Create Room Form
    elements.createRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const roomName = elements.roomName.value.trim();
        const password = elements.createPassword.value;

        // Clear previous errors
        UI.hideError('room-name');
        UI.hideError('create-password');

        // Validate inputs
        const roomNameError = Validator.validateRoomName(roomName);
        const passwordError = Validator.validatePassword(password);

        if (roomNameError) {
            UI.showError('room-name', roomNameError);
            return;
        }
        if (passwordError) {
            UI.showError('create-password', passwordError);
            return;
        }

        await createRoom(roomName, password);
    });

    // Join Room Form
    elements.joinRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const roomId = elements.roomId.value.trim();
        const password = elements.joinPassword.value;

        // Clear previous errors
        UI.hideError('room-id');
        UI.hideError('join-password');

        // Validate inputs
        const roomIdError = Validator.validateRoomId(roomId);
        const passwordError = Validator.validatePassword(password);

        if (roomIdError) {
            UI.showError('room-id', roomIdError);
            return;
        }
        if (passwordError) {
            UI.showError('join-password', passwordError);
            return;
        }

        UI.showElement(elements.usernameModal);
        currentRoom = { id: roomId, password };
    });

    // Username Form
    elements.usernameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = elements.username.value.trim();

        // Clear previous errors
        UI.hideError('username');

        // Validate username
        const usernameError = Validator.validateUsername(username);
        if (usernameError) {
            UI.showError('username', usernameError);
            return;
        }

        currentUser = username;
        if (socket && socket.connected) {
            socket.emit('join-room', { roomId: currentRoom.id, password: currentRoom.password, username: username });
        } else {
            // Demo mode - simulate entering chat
            currentRoom.roomName = 'Demo Room';
            currentRoom.participants = [username];
            UI.hideElement(elements.usernameModal);
            showChatInterface();
            addSystemMessage('Welcome to demo mode! Backend server is not running.');
        }
    });

    // Message Input
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        } else {
            startTyping();
        }
    });

    elements.sendBtn.addEventListener('click', sendMessage);

    // Emoji Picker
    elements.emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.emojiPicker.classList.toggle('hidden');
    });

    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        if (!elements.emojiBtn.contains(e.target) && !elements.emojiPicker.contains(e.target)) {
            UI.hideElement(elements.emojiPicker);
        }
    });

    // Room Actions
    elements.proceedToRoom.addEventListener('click', () => {
        UI.showElement(elements.usernameModal);
    });

    elements.copyRoomId.addEventListener('click', () => {
        UI.copyToClipboard(elements.createdRoomId.value);
    });

    elements.copyInviteLink.addEventListener('click', () => {
        UI.copyToClipboard(elements.inviteLink.value);
    });

    elements.inviteBtn.addEventListener('click', () => {
        const inviteLink = `${window.location.origin}/?roomId=${currentRoom.id}`;
        UI.copyToClipboard(inviteLink);
    });

    elements.leaveRoom.addEventListener('click', leaveRoom);

    // Close modals on outside click
    [elements.roomCreatedModal, elements.usernameModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                UI.hideElement(modal);
            }
        });
    });
}

// URL Parameters Handling
function handleURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');
    if (roomId && Validator.validateRoomId(roomId) === null) {
        elements.roomId.value = roomId;
        elements.roomId.focus();
    }
}

// Initialize Application
function initialize() {
    console.log('Initializing SecureChat...');
    initializeSocket();
    initializeEventListeners();
    initializeEmojiPicker();
    handleURLParameters();
    console.log('SecureChat initialized successfully');
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initialize);

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopTyping();
    }
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (socket && socket.connected && currentRoom) {
        socket.emit('leave-room', { roomId: currentRoom.id });
    }
});
