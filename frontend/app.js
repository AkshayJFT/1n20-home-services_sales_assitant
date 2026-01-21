/**
 * PDF Presentation System - Frontend JavaScript
 * Modern UI with Image Explorer Layout
 */

// ============================================================================
// State Management
// ============================================================================
const AppState = {
    isPlaying: false,
    isPaused: false,
    currentSection: 0,
    totalSections: 0,
    currentImages: [],
    currentImageIndex: 0,
    currentContent: '',
    currentWords: [],
    referenceImages: [],
    ws: null,
    ttsEnabled: true,
    ttsVoice: 'asteria',
    isAudioPlaying: false,
    audioDuration: 0,
    voiceOnlyMode: false,
    wordTimers: [],
    currentWordIndex: 0,
    isRecording: false,
    speechRecognition: null,
    finalTranscript: '',
    presentationSpeed: 1,
    sectionDelay: 0.5,
    isRegistered: false,
    userInfo: null,
    selectedProduct: null,  // { id, name, slug }
    availableProducts: [],
    // TTS Pre-generation
    sectionData: [],           // All section content for pre-generation
    ttsCache: new Map(),       // Cache: sectionIndex -> { audio: base64, generating: boolean }
    pregenAhead: 0,            // Disabled - generate one-by-one (voice/speed can change anytime)
    // Chat TTS (separate from presentation)
    chatTtsEnabled: true,      // Mute/unmute chat voice
    isChatAudioPlaying: false, // Is chat audio currently playing
    chatAudioQueue: [],        // Queue for chat audio chunks
    presentationPausedForChat: false, // Track if we paused presentation for chat audio
    isChatActive: false,       // Block ALL presentation audio when chat is active
    chatImageTimers: [],       // Timers for cycling chat reference images
    chatAudioDuration: 0,      // Duration of current chat audio
};

// ============================================================================
// DOM Elements
// ============================================================================
const elements = {
    // Image panel
    imageDisplay: document.getElementById('imageDisplay'),
    imageCounter: document.getElementById('imageCounter'),
    thumbnailStrip: document.getElementById('thumbnailStrip'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    playPauseIcon: document.getElementById('playPauseIcon'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    stopBtn: document.getElementById('stopBtn'),
    voiceOnlyBtn: document.getElementById('voiceOnlyBtn'),
    voiceOnlyIcon: document.getElementById('voiceOnlyIcon'),
    presentationTitle: document.getElementById('presentationTitle'),
    statusBadge: document.getElementById('statusBadge'),
    currentSection: document.getElementById('currentSection'),
    sectionTitle: document.getElementById('sectionTitle'),
    sectionBadge: document.getElementById('sectionBadge'),
    sectionContent: document.getElementById('sectionContent'),
    keyTakeaways: document.getElementById('keyTakeaways'),
    takeawaysList: document.getElementById('takeawaysList'),
    welcomeUserName: document.getElementById('welcomeUserName'),
    // Chat
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    voiceIndicator: document.getElementById('voiceIndicator'),
    cancelVoice: document.getElementById('cancelVoice'),
    // Settings
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettings: document.getElementById('closeSettings'),
    voiceSelect: document.getElementById('voiceSelect'),
    autoTTS: document.getElementById('autoTTS'),
    speedSlider: document.getElementById('speedSlider'),
    speedValue: document.getElementById('speedValue'),
    sectionDelay: document.getElementById('sectionDelay'),
    audioPlayer: document.getElementById('audioPlayer'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    // Chat audio elements
    chatAudioPlayer: document.getElementById('chatAudioPlayer'),
    chatMuteBtn: document.getElementById('chatMuteBtn'),
    chatMuteIcon: document.getElementById('chatMuteIcon'),
};

// Registration state
const RegistrationState = {
    step: 'name', // 'name', 'email', 'phone', 'product', 'complete'
    name: '',
    email: '',
    phone: '',
};

// ============================================================================
// Initialization
// ============================================================================
async function init() {
    console.log('Initializing PDF Presentation System...');
    loadTheme();
    await loadSettings();  // Load settings from server first
    loadChatTtsSettings(); // Load chat TTS mute preference
    checkRegistration();
    await loadPresentation();
    setupEventListeners();
    console.log('Initialization complete');
}

// ============================================================================
// Conversational Registration System
// ============================================================================
function checkRegistration() {
    // Clear existing data for fresh start each time (testing mode)
    localStorage.removeItem('userInfo');

    // Always start fresh registration conversation
    startRegistrationConversation();
}

function startRegistrationConversation() {
    AppState.isRegistered = false;
    RegistrationState.step = 'name';

    // Clear chat and show welcome
    elements.chatMessages.innerHTML = '';

    // Add welcome message with delay for effect
    setTimeout(() => {
        addBotMessage("Hello! Welcome to 1n20 Home Services. 👋");
    }, 300);

    setTimeout(() => {
        addBotMessage("Before we begin, I'd love to know a bit about you.");
    }, 1000);

    setTimeout(() => {
        addBotMessage("What's your name?");
        elements.chatInput.placeholder = "Enter your name...";
        elements.chatInput.focus();
    }, 1700);
}

function showWelcomeBack() {
    elements.chatMessages.innerHTML = '';

    const firstName = AppState.userInfo.name.split(' ')[0];
    elements.welcomeUserName.textContent = `Hi ${firstName}! How can I help?`;

    setTimeout(() => {
        addBotMessage(`Welcome back, ${firstName}! 👋`);
    }, 300);

    setTimeout(() => {
        addBotMessage("I'm ready to help you explore the presentation. Click Play to start, or ask me any questions!");
        elements.chatInput.placeholder = "Type your message...";
    }, 1000);
}

// LLM-based extraction and validation
async function extractAndValidate(message, field) {
    try {
        const response = await fetch('/api/extract-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, field })
        });
        return await response.json();
    } catch (error) {
        console.error('Extraction error:', error);
        return { extracted: '', valid: false, error: 'Connection error. Please try again.' };
    }
}

async function handleRegistrationInput(message) {
    const trimmedMessage = message.trim();

    // Show typing indicator
    addTypingIndicator();

    switch (RegistrationState.step) {
        case 'name':
            const nameResult = await extractAndValidate(trimmedMessage, 'name');
            removeTypingIndicator();

            if (nameResult.valid && nameResult.extracted) {
                RegistrationState.name = nameResult.extracted;
                RegistrationState.step = 'email';

                setTimeout(() => {
                    addBotMessage(`Nice to meet you, ${nameResult.extracted.split(' ')[0]}! 😊`);
                }, 300);

                setTimeout(() => {
                    addBotMessage("What's your email address?");
                    elements.chatInput.placeholder = "Enter your email...";
                }, 1000);
            } else {
                setTimeout(() => {
                    addBotMessage(nameResult.error || "I couldn't catch your name. Could you please tell me again?");
                }, 300);
            }
            break;

        case 'email':
            const emailResult = await extractAndValidate(trimmedMessage, 'email');
            removeTypingIndicator();

            if (emailResult.valid && emailResult.extracted) {
                RegistrationState.email = emailResult.extracted;
                RegistrationState.step = 'phone';

                setTimeout(() => {
                    addBotMessage("Great! Almost done.");
                }, 300);

                setTimeout(() => {
                    addBotMessage("What's your phone number?");
                    elements.chatInput.placeholder = "Enter your phone number...";
                }, 1000);
            } else {
                setTimeout(() => {
                    addBotMessage(emailResult.error || "That doesn't look like a valid email. Could you try again?");
                }, 300);
            }
            break;

        case 'phone':
            const phoneResult = await extractAndValidate(trimmedMessage, 'phone');
            removeTypingIndicator();

            if (phoneResult.valid && phoneResult.extracted) {
                RegistrationState.phone = phoneResult.extracted;

                // Register user in database
                try {
                    const registerResponse = await fetch('/api/user/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: RegistrationState.name,
                            email: RegistrationState.email,
                            phone: RegistrationState.phone
                        })
                    });
                    const registerData = await registerResponse.json();

                    const userInfo = {
                        id: registerData.user_id,
                        name: RegistrationState.name,
                        email: RegistrationState.email,
                        phone: RegistrationState.phone,
                        registeredAt: new Date().toISOString(),
                    };

                    localStorage.setItem('userInfo', JSON.stringify(userInfo));
                    AppState.userInfo = userInfo;

                    const firstName = RegistrationState.name.split(' ')[0];
                    elements.welcomeUserName.textContent = `Hi ${firstName}!`;

                    // Check if there are products to choose from
                    await loadAvailableProducts();

                    if (AppState.availableProducts.length > 1) {
                        // Multiple products - ask user to choose
                        RegistrationState.step = 'product';

                        setTimeout(() => {
                            addBotMessage("Perfect! Almost done! 🎉");
                        }, 300);

                        setTimeout(() => {
                            showProductSelection();
                        }, 1000);
                    } else if (AppState.availableProducts.length === 1) {
                        // Only one product - auto-select it
                        AppState.selectedProduct = AppState.availableProducts[0];
                        await completeRegistration(firstName);
                    } else {
                        // No products available yet
                        setTimeout(() => {
                            addBotMessage("Perfect! You're registered! 🎉");
                        }, 300);

                        setTimeout(() => {
                            addBotMessage("No presentations are available yet. Please check back later or contact the administrator.");
                            elements.chatInput.placeholder = "Type your message...";
                        }, 1000);

                        AppState.isRegistered = true;
                        RegistrationState.step = 'complete';
                    }

                    console.log('User registered:', userInfo);
                } catch (error) {
                    console.error('Registration error:', error);
                    addBotMessage("There was an issue saving your info. Please try again.");
                }
            } else {
                setTimeout(() => {
                    addBotMessage(phoneResult.error || "That doesn't seem like a valid phone number. Please try again.");
                }, 300);
            }
            break;

        case 'product':
            // Handle product selection by number or name
            await handleProductSelection(trimmedMessage);
            break;
    }
}

// Load available products from API
async function loadAvailableProducts() {
    try {
        const response = await fetch('/api/products');
        AppState.availableProducts = await response.json();
    } catch (error) {
        console.error('Error loading products:', error);
        AppState.availableProducts = [];
    }
}

// Show product selection options
function showProductSelection() {
    const products = AppState.availableProducts;

    let productList = products.map((p, i) => `${i + 1}. ${p.name}`).join('\n');

    addBotMessage(`What would you like to explore today?\n\n${productList}\n\nJust type the number or name of your choice.`);
    elements.chatInput.placeholder = "Choose a product...";
}

// Handle product selection input
async function handleProductSelection(message) {
    // Note: typing indicator already added by handleRegistrationInput

    const products = AppState.availableProducts;
    let selectedProduct = null;

    // Try to match by number
    const numMatch = message.match(/^(\d+)$/);
    if (numMatch) {
        const index = parseInt(numMatch[1]) - 1;
        if (index >= 0 && index < products.length) {
            selectedProduct = products[index];
        }
    }

    // Try to match by name (partial, case-insensitive)
    if (!selectedProduct) {
        const lowerMessage = message.toLowerCase();
        selectedProduct = products.find(p =>
            p.name.toLowerCase().includes(lowerMessage) ||
            p.slug.toLowerCase().includes(lowerMessage)
        );
    }

    removeTypingIndicator();

    if (selectedProduct) {
        AppState.selectedProduct = selectedProduct;
        const firstName = RegistrationState.name.split(' ')[0];
        await completeRegistration(firstName);
    } else {
        setTimeout(() => {
            addBotMessage("I didn't recognize that option. Please choose from the list:");
            showProductSelection();
        }, 300);
    }
}

// Complete the registration process
async function completeRegistration(firstName) {
    RegistrationState.step = 'complete';
    AppState.isRegistered = true;

    // Save selected product to localStorage
    localStorage.setItem('selectedProduct', JSON.stringify(AppState.selectedProduct));

    setTimeout(() => {
        addBotMessage(`Great choice! You've selected **${AppState.selectedProduct.name}**. 🎉`);
    }, 300);

    setTimeout(() => {
        addBotMessage(`Thanks for registering, ${firstName}. You now have full access to the presentation.`);
    }, 1000);

    setTimeout(() => {
        addBotMessage("Click the Play button to start, or feel free to ask me anything!");
        elements.chatInput.placeholder = "Type your message...";
    }, 1700);

    // Load the selected product's presentation
    await loadPresentation();
}

function addTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message assistant typing-indicator-msg';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = `
        <div class="message-avatar"><i class="fas fa-robot"></i></div>
        <div class="message-wrapper">
            <div class="message-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
    elements.chatMessages.appendChild(indicator);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function addBotMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    // Parse basic markdown (bold, italic) for bot messages
    const parsedText = text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    contentDiv.innerHTML = `<p>${parsedText}</p>`;

    const timeDiv = document.createElement('span');
    timeDiv.className = 'message-time';
    timeDiv.textContent = formatTime(new Date());

    wrapper.appendChild(contentDiv);
    wrapper.appendChild(timeDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(wrapper);

    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addUserMessageSimple(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-user"></i>';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = `<p>${escapeHtml(text)}</p>`;

    const timeDiv = document.createElement('span');
    timeDiv.className = 'message-time';
    timeDiv.textContent = formatTime(new Date());

    wrapper.appendChild(contentDiv);
    wrapper.appendChild(timeDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(wrapper);

    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function requireRegistration(action) {
    if (!AppState.isRegistered) {
        addBotMessage(`Please complete the registration first to ${action}. Just answer my questions above! 👆`);
        return false;
    }
    return true;
}

async function loadPresentation() {
    try {
        // Build URL with product_id if selected
        let url = '/api/presentation/load';
        if (AppState.selectedProduct && AppState.selectedProduct.id) {
            url += `?product_id=${AppState.selectedProduct.id}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'success') {
            elements.presentationTitle.textContent = '1n20 Home Services';
            AppState.totalSections = data.sections;
            AppState.sectionData = data.section_data || [];  // Store for caching
            AppState.ttsCache.clear();  // Clear cache when loading new presentation
            preloadedImages.clear();    // Clear image preload tracker
            updateProgress();

            const productInfo = AppState.selectedProduct
                ? ` (${AppState.selectedProduct.name})`
                : '';
            console.log(`Loaded: ${data.title}${productInfo} (${data.sections} sections)`);

            // Preload images for first 3 sections immediately (so they're ready when play is clicked)
            if (AppState.sectionData.length > 0) {
                preloadImagesForSections(0, Math.min(3, AppState.sectionData.length));
                console.log('[Images] Preloading sections 0-2 images');
            }
        } else {
            if (AppState.selectedProduct) {
                showSystemMessage(`No presentation found for ${AppState.selectedProduct.name}. The admin may need to upload content.`);
            } else {
                showSystemMessage('No presentation found. Please generate one first.');
            }
        }
    } catch (error) {
        console.error('Failed to load presentation:', error);
        showSystemMessage('Failed to load presentation.');
    }
}

// ============================================================================
// Event Listeners
// ============================================================================
function setupEventListeners() {
    // Presentation controls (with registration check)
    elements.playPauseBtn.addEventListener('click', () => {
        if (requireRegistration('start the presentation')) {
            togglePlayPause();
        }
    });
    elements.prevBtn.addEventListener('click', () => {
        if (requireRegistration('navigate')) {
            previousSection();
        }
    });
    elements.nextBtn.addEventListener('click', () => {
        if (requireRegistration('navigate')) {
            nextSection();
        }
    });
    elements.stopBtn.addEventListener('click', stopPresentation);
    elements.voiceOnlyBtn.addEventListener('click', toggleVoiceOnlyMode);

    // Chat input - handles both registration and normal chat
    elements.chatInput.addEventListener('keydown', handleChatKeydown);
    elements.chatInput.addEventListener('input', handleChatInput);
    elements.sendBtn.addEventListener('click', handleSendClick);

    elements.voiceBtn.addEventListener('click', toggleVoiceRecording);
    elements.cancelVoice.addEventListener('click', cancelVoiceRecording);

    elements.settingsBtn.addEventListener('click', () => elements.settingsModal.classList.add('active'));
    elements.closeSettings.addEventListener('click', () => elements.settingsModal.classList.remove('active'));
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) elements.settingsModal.classList.remove('active');
    });

    elements.voiceSelect.addEventListener('change', (e) => {
        AppState.ttsVoice = e.target.value;
        AppState.ttsCache.clear();  // Clear cache - voice changed
        console.log('[TTS] Cache cleared - voice changed to:', e.target.value);
        saveSettings();
    });
    elements.autoTTS.addEventListener('change', (e) => {
        AppState.ttsEnabled = e.target.checked;
        saveSettings();
    });
    elements.speedSlider.addEventListener('input', (e) => {
        AppState.presentationSpeed = parseFloat(e.target.value);
        elements.speedValue.textContent = `${AppState.presentationSpeed}x`;
        AppState.ttsCache.clear();  // Clear cache - speed changed
        console.log('[TTS] Cache cleared - speed changed to:', e.target.value);
        saveSettings();
    });
    elements.sectionDelay.addEventListener('change', (e) => {
        AppState.sectionDelay = parseFloat(e.target.value);
        saveSettings();
    });

    elements.audioPlayer.addEventListener('ended', onAudioEnded);
    elements.audioPlayer.addEventListener('timeupdate', onAudioTimeUpdate);

    // Chat audio events
    elements.chatAudioPlayer.addEventListener('ended', onChatAudioEnded);
    elements.chatAudioPlayer.addEventListener('error', onChatAudioError);
    elements.chatMuteBtn.addEventListener('click', toggleChatMute);

    // Theme toggle
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
}

// ============================================================================
// Theme Toggle
// ============================================================================
function toggleTheme() {
    const body = document.body;
    const isLightTheme = body.classList.toggle('light-theme');

    // Update icon
    elements.themeIcon.className = isLightTheme ? 'fas fa-sun' : 'fas fa-moon';

    // Save preference
    localStorage.setItem('theme', isLightTheme ? 'light' : 'dark');
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        elements.themeIcon.className = 'fas fa-sun';
    } else {
        document.body.classList.remove('light-theme');
        elements.themeIcon.className = 'fas fa-moon';
    }
}

// ============================================================================
// Voice-Only Mode
// ============================================================================
function toggleVoiceOnlyMode() {
    AppState.voiceOnlyMode = !AppState.voiceOnlyMode;

    if (AppState.voiceOnlyMode) {
        elements.voiceOnlyBtn.classList.add('active');
        elements.currentSection.classList.add('voice-only-mode');
        elements.voiceOnlyIcon.className = 'fas fa-eye-slash';
    } else {
        elements.voiceOnlyBtn.classList.remove('active');
        elements.currentSection.classList.remove('voice-only-mode');
        elements.voiceOnlyIcon.className = 'fas fa-headphones';

        if (AppState.currentContent && AppState.isPlaying) {
            elements.sectionContent.innerHTML = `<p>${AppState.currentContent}</p>`;
        }
    }
    saveSettings();
}

// ============================================================================
// Presentation Control
// ============================================================================
function togglePlayPause() {
    if (!AppState.isPlaying) {
        startPresentation();
    } else if (AppState.isPaused) {
        resumePresentation();
    } else {
        pausePresentation();
    }
}

async function startPresentation() {
    if (AppState.ws) {
        AppState.ws.close();
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/presentation`;
    AppState.ws = new WebSocket(wsUrl);

    AppState.ws.onopen = () => {
        AppState.isPlaying = true;
        AppState.isPaused = false;
        updatePlayPauseButton();
        updateStatus('playing');
        // Remove chat welcome message when presentation starts
        const welcome = elements.chatMessages.querySelector('.chat-welcome');
        if (welcome) welcome.remove();
    };

    AppState.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    AppState.ws.onclose = () => {
        if (AppState.isPlaying) {
            AppState.isPlaying = false;
            AppState.isPaused = false;
            updatePlayPauseButton();
            updateStatus('ready');
        }
    };

    AppState.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showSystemMessage('Connection error.');
    };
}

async function pausePresentation() {
    AppState.isPaused = true;
    updatePlayPauseButton();
    updateStatus('paused');
    stopAudio();
    clearWordTimers();

    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        AppState.ws.send(JSON.stringify({ action: 'pause' }));
    }
}

async function resumePresentation() {
    // Stop any chat audio and clear chat active flag
    stopChatAudio();
    AppState.isChatActive = false;
    AppState.isPaused = false;

    updatePlayPauseButton();
    updateStatus('playing');
    console.log('[Resume] Presentation resumed - chat inactive');

    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        AppState.ws.send(JSON.stringify({ action: 'resume' }));
    }
}

function stopPresentation() {
    if (AppState.ws) {
        AppState.ws.send(JSON.stringify({ action: 'stop' }));
        AppState.ws.close();
    }

    AppState.isPlaying = false;
    AppState.isPaused = false;
    AppState.isChatActive = false;
    AppState.currentSection = 0;

    updatePlayPauseButton();
    updateStatus('ready');
    updateProgress();
    stopAudio();
    stopChatAudio();
    clearWordTimers();
    AppState.ttsCache.clear();  // Clear TTS cache
    preloadedImages.clear();    // Clear image preload tracker

    elements.sectionTitle.textContent = 'Welcome';
    elements.sectionContent.innerHTML = '<p class="placeholder-text">Click play to start the presentation</p>';
    elements.keyTakeaways.style.display = 'none';
    resetImageDisplay();
    clearThumbnails();
}

function nextSection() {
    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        stopAudio();
        clearWordTimers();
        AppState.ws.send(JSON.stringify({ action: 'next' }));
    }
}

function previousSection() {
    console.log('Previous section not implemented in streaming mode');
}

// ============================================================================
// WebSocket Message Handler
// ============================================================================
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'start':
            AppState.totalSections = data.total_sections;
            updateProgress();
            break;

        case 'section':
            // COMPLETELY IGNORE section messages when chat is active or paused
            if (AppState.isChatActive || AppState.isPaused) {
                console.log('[WebSocket] Ignoring section - chat active or paused');
                return;
            }
            handleSection(data);
            break;

        case 'status':
            if (data.status === 'paused') {
                AppState.isPaused = true;
                updatePlayPauseButton();
                updateStatus('paused');
            }
            break;

        case 'complete':
            showSystemMessage('Presentation complete! Feel free to ask any questions.');
            AppState.isPlaying = false;
            AppState.isPaused = false;
            updatePlayPauseButton();
            updateStatus('complete');
            break;

        case 'stopped':
            AppState.isPlaying = false;
            break;

        case 'error':
            console.error('Error:', data.message);
            showSystemMessage(`Error: ${data.message}`);
            break;
    }
}

async function handleSection(data) {
    // Double-check: bail immediately if chat active or paused
    if (AppState.isChatActive || AppState.isPaused) {
        console.log(`[Section] BLOCKED section ${data.section_index} - chat active or paused`);
        return;
    }

    clearWordTimers();

    console.log(`[Section] Processing section ${data.section_index}:`, {
        title: data.title,
        images: data.images,
        contentLength: data.content?.length
    });

    AppState.currentSection = data.section_index;
    AppState.currentImages = data.images || [];
    AppState.currentImageIndex = 0;
    AppState.currentContent = data.content || '';
    AppState.currentWords = AppState.currentContent.split(/\s+/).filter(w => w.length > 0);
    AppState.currentWordIndex = 0;

    elements.sectionTitle.textContent = data.title;
    elements.sectionBadge.textContent = `${data.section_index + 1} / ${data.total_sections}`;

    if (AppState.voiceOnlyMode) {
        elements.sectionContent.innerHTML = '<div class="voice-only-indicator"><i class="fas fa-volume-high"></i><p>Voice Only Mode</p></div>';
    } else {
        elements.sectionContent.innerHTML = '<p></p>';
    }

    elements.keyTakeaways.style.display = 'none';

    updateProgress();
    updateThumbnails();

    if (AppState.currentImages.length > 0) {
        displayImagesGrid(AppState.currentImages, 0);
    }

    // Don't play TTS if presentation is paused OR chat is active
    if (AppState.isPaused || AppState.isChatActive) {
        console.log('[Presentation] Paused/Chat active - skipping TTS for section', data.section_index);
        if (!AppState.voiceOnlyMode) {
            elements.sectionContent.innerHTML = `<p>${data.content}</p>`;
        }
        return;
    }

    if (AppState.ttsEnabled && data.content) {
        await speakSectionWithTextSync(data.content, data.section_index);
    } else {
        // Preload images for upcoming sections
        const startFrom = data.section_index + 1;
        preloadImagesForSections(startFrom, startFrom + AppState.pregenAhead);
        if (!AppState.voiceOnlyMode) {
            elements.sectionContent.innerHTML = `<p>${data.content}</p>`;
        }
        await delay(AppState.sectionDelay * 1000);
        signalSectionDone();
    }
}

// ============================================================================
// Thumbnail Strip
// ============================================================================
function updateThumbnails() {
    elements.thumbnailStrip.innerHTML = '';

    AppState.currentImages.forEach((imagePath, index) => {
        const btn = document.createElement('button');
        btn.className = `thumbnail-btn ${index === AppState.currentImageIndex ? 'active' : ''}`;

        const imageUrl = normalizeImagePath(imagePath);

        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = `Thumbnail ${index + 1}`;
        img.loading = 'lazy';

        btn.appendChild(img);
        btn.addEventListener('click', () => selectImage(index));
        elements.thumbnailStrip.appendChild(btn);
    });
}

function selectImage(index) {
    if (index < 0 || index >= AppState.currentImages.length) return;

    AppState.currentImageIndex = index;

    // Display the selected image (single image view)
    displayImage(AppState.currentImages[index], index);

    // Update thumbnail active state
    const thumbnails = elements.thumbnailStrip.querySelectorAll('.thumbnail-btn');
    thumbnails.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });

    // Scroll thumbnail into view
    const activeThumbnail = thumbnails[index];
    if (activeThumbnail) {
        activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
}

function clearThumbnails() {
    elements.thumbnailStrip.innerHTML = '';
}

// ============================================================================
// Text-Synced TTS with Pre-generation
// ============================================================================

// Pre-generate TTS for a specific section (runs in background, returns immediately)
function preGenerateTTS(sectionIndex) {
    // Skip if already cached or being generated
    if (AppState.ttsCache.has(sectionIndex)) {
        return;
    }

    // Skip if section doesn't exist
    if (sectionIndex >= AppState.sectionData.length) {
        return;
    }

    const section = AppState.sectionData[sectionIndex];
    if (!section || !section.content) {
        return;
    }

    // Mark as generating
    AppState.ttsCache.set(sectionIndex, { audio: null, generating: true });
    console.log(`[TTS] Pre-generating section ${sectionIndex}...`);

    // Fire and forget - don't await
    fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: section.content,
            voice: AppState.ttsVoice
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.audio) {
            AppState.ttsCache.set(sectionIndex, { audio: data.audio, generating: false });
            console.log(`[TTS] Section ${sectionIndex} cached ✓`);
        } else {
            AppState.ttsCache.delete(sectionIndex);
        }
    })
    .catch(error => {
        console.error(`[TTS] Pre-generation failed for section ${sectionIndex}:`, error);
        AppState.ttsCache.delete(sectionIndex);
    });
}

// Kick off parallel pre-generation for upcoming sections
function startParallelPregeneration(currentSection) {
    if (!AppState.ttsEnabled || AppState.sectionData.length === 0) {
        return;
    }

    // Pre-generate next N sections IN PARALLEL (fire and forget)
    const startFrom = currentSection + 1;
    const endAt = Math.min(startFrom + AppState.pregenAhead, AppState.sectionData.length);

    console.log(`[TTS] Parallel pre-gen for sections ${startFrom} to ${endAt - 1}`);

    for (let i = startFrom; i < endAt; i++) {
        preGenerateTTS(i);  // Non-blocking, runs in parallel
    }

    // Also preload images in parallel
    preloadImagesForSections(startFrom, endAt);
}

// Fetch TTS - use cache if available, otherwise fetch on-demand
async function fetchTTS(content, sectionIndex) {
    // Check cache first
    const cached = AppState.ttsCache.get(sectionIndex);

    if (cached && cached.audio) {
        console.log(`[TTS] Cache HIT for section ${sectionIndex}`);
        return cached.audio;
    }

    // If currently generating, wait briefly
    if (cached && cached.generating) {
        console.log(`[TTS] Waiting for section ${sectionIndex}...`);
        for (let i = 0; i < 50; i++) {  // Max 5 seconds
            await delay(100);
            const updated = AppState.ttsCache.get(sectionIndex);
            if (updated && updated.audio) {
                console.log(`[TTS] Section ${sectionIndex} ready from pre-gen`);
                return updated.audio;
            }
            if (!updated || !updated.generating) break;
        }
    }

    // Fetch on-demand
    console.log(`[TTS] On-demand fetch for section ${sectionIndex}`);
    try {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content, voice: AppState.ttsVoice })
        });
        const data = await response.json();
        if (data.audio) {
            AppState.ttsCache.set(sectionIndex, { audio: data.audio, generating: false });
            return data.audio;
        }
    } catch (error) {
        console.error('[TTS] Fetch failed:', error);
    }
    return null;
}

async function speakSectionWithTextSync(content, sectionIndex = AppState.currentSection) {
    // Don't play if presentation is paused OR chat is active OR chat audio is playing
    if (AppState.isPaused || AppState.isChatActive || AppState.isChatAudioPlaying) {
        console.log(`[TTS] BLOCKED section ${sectionIndex} - paused:`, AppState.isPaused,
                    'chatActive:', AppState.isChatActive, 'chatAudioPlaying:', AppState.isChatAudioPlaying);
        return;
    }

    try {
        // Check if we have cached audio (from same session, same voice/speed)
        const cached = AppState.ttsCache.get(sectionIndex);

        if (cached && cached.audio) {
            // Cache HIT - use cached audio (only valid if voice/speed hasn't changed)
            console.log(`[TTS] Cache HIT for section ${sectionIndex}`);
            playAudioWithTextSync(cached.audio);
            return;
        }

        // Generate TTS for current section only (one-by-one, no pre-gen)
        console.log(`[TTS] Generating section ${sectionIndex}...`);

        // Fetch current section TTS (this blocks until ready)
        const audio = await fetchTTSDirect(content);

        // Re-check state after async fetch (might have changed during fetch)
        if (AppState.isPaused || AppState.isChatActive || AppState.isChatAudioPlaying) {
            console.log(`[TTS] State changed during fetch - BLOCKED. paused:`, AppState.isPaused,
                        'chatActive:', AppState.isChatActive, 'chatAudioPlaying:', AppState.isChatAudioPlaying);
            if (audio) {
                AppState.ttsCache.set(sectionIndex, { audio, generating: false });
            }
            return;
        }

        if (audio) {
            AppState.ttsCache.set(sectionIndex, { audio, generating: false });
            playAudioWithTextSync(audio);
        } else {
            if (!AppState.voiceOnlyMode) {
                elements.sectionContent.innerHTML = `<p>${content}</p>`;
            }
            await delay(AppState.sectionDelay * 1000);
            signalSectionDone();
        }
    } catch (error) {
        console.error('TTS error:', error);
        if (!AppState.voiceOnlyMode) {
            elements.sectionContent.innerHTML = `<p>${content}</p>`;
        }
        await delay(AppState.sectionDelay * 1000);
        signalSectionDone();
    }
}

// Direct TTS fetch (no cache check, used for current section)
async function fetchTTSDirect(content) {
    try {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content, voice: AppState.ttsVoice })
        });
        const data = await response.json();
        return data.audio || null;
    } catch (error) {
        console.error('[TTS] Direct fetch failed:', error);
        return null;
    }
}

// ============================================================================
// Image Preloading (Fast, Parallel, Fire-and-Forget)
// ============================================================================
const preloadedImages = new Set();  // Track URLs we've started preloading

// Preload images for a range of sections (fire and forget)
function preloadImagesForSections(startSection, endSection) {
    for (let i = startSection; i < endSection; i++) {
        if (i >= AppState.sectionData.length) break;

        const section = AppState.sectionData[i];
        if (!section || !section.images) continue;

        section.images.forEach(imagePath => {
            const imageUrl = normalizeImagePath(imagePath);

            // Skip if already preloading/preloaded
            if (preloadedImages.has(imageUrl)) return;
            preloadedImages.add(imageUrl);

            // Fire and forget - browser caches automatically
            const img = new Image();
            img.src = imageUrl;
        });
    }
    console.log(`[Images] Preloading sections ${startSection}-${endSection - 1}`);
}

function playAudioWithTextSync(base64Audio) {
    // Don't play if presentation is paused OR chat is active OR chat audio is playing
    if (AppState.isPaused || AppState.isChatActive || AppState.isChatAudioPlaying) {
        console.log('[Presentation] BLOCKED - paused:', AppState.isPaused,
                    'chatActive:', AppState.isChatActive,
                    'chatAudioPlaying:', AppState.isChatAudioPlaying);
        return;
    }

    const audioBlob = base64ToBlob(base64Audio, 'audio/mp3');
    const audioUrl = URL.createObjectURL(audioBlob);

    elements.audioPlayer.src = audioUrl;
    elements.audioPlayer.playbackRate = AppState.presentationSpeed;

    elements.audioPlayer.onloadedmetadata = () => {
        AppState.audioDuration = elements.audioPlayer.duration;
        scheduleWordStreaming();
        // Grid display - no image cycling needed
    };

    elements.audioPlayer.play();
    AppState.isAudioPlaying = true;
}

function scheduleWordStreaming() {
    if (AppState.voiceOnlyMode) return;

    const words = AppState.currentWords;
    if (words.length === 0) return;

    const effectiveDuration = AppState.audioDuration / AppState.presentationSpeed;
    const msPerWord = (effectiveDuration * 1000) / words.length;

    elements.sectionContent.innerHTML = '<p id="streamingText"></p>';
    const textContainer = document.getElementById('streamingText');

    words.forEach((word, index) => {
        const timer = setTimeout(() => {
            if (AppState.isPaused || !AppState.isAudioPlaying) return;

            AppState.currentWordIndex = index;

            const wordSpan = document.createElement('span');
            wordSpan.className = 'streamed-word current-word';
            wordSpan.textContent = word + ' ';
            textContainer.appendChild(wordSpan);

            setTimeout(() => {
                wordSpan.classList.remove('current-word');
            }, msPerWord * 0.8);

            elements.sectionContent.scrollTop = elements.sectionContent.scrollHeight;

        }, msPerWord * index);

        AppState.wordTimers.push(timer);
    });
}

function clearWordTimers() {
    AppState.wordTimers.forEach(timer => clearTimeout(timer));
    AppState.wordTimers = [];
}

function scheduleImageChanges() {
    const images = AppState.currentImages;
    if (images.length <= 1) return;

    const effectiveDuration = AppState.audioDuration / AppState.presentationSpeed;
    const msPerImage = (effectiveDuration * 1000) / images.length;

    for (let i = 1; i < images.length; i++) {
        const timer = setTimeout(() => {
            if (AppState.isAudioPlaying && !AppState.isPaused) {
                selectImage(i);
            }
        }, msPerImage * i);

        AppState.wordTimers.push(timer);
    }
}

// Schedule chat reference image changes based on chat audio duration
function scheduleChatImageChanges(audioDuration) {
    clearChatImageTimers();

    const images = AppState.currentImages;
    if (images.length <= 1) return;

    const effectiveDuration = audioDuration / AppState.presentationSpeed;
    const msPerImage = (effectiveDuration * 1000) / images.length;

    console.log(`[Chat Images] Scheduling ${images.length} images, ${msPerImage.toFixed(0)}ms each`);

    for (let i = 1; i < images.length; i++) {
        const timer = setTimeout(() => {
            if (AppState.isChatAudioPlaying) {
                AppState.currentImageIndex = i;
                displayImage(AppState.currentImages[i], i);
                console.log(`[Chat Images] Showing image ${i + 1}/${images.length}`);
            }
        }, msPerImage * i);

        AppState.chatImageTimers.push(timer);
    }
}

function clearChatImageTimers() {
    AppState.chatImageTimers.forEach(timer => clearTimeout(timer));
    AppState.chatImageTimers = [];
}

function onAudioTimeUpdate() {}

function onAudioEnded() {
    AppState.isAudioPlaying = false;

    if (!AppState.voiceOnlyMode) {
        elements.sectionContent.innerHTML = `<p>${AppState.currentContent}</p>`;
    }

    setTimeout(() => {
        if (!AppState.isPaused && AppState.isPlaying) {
            signalSectionDone();
        }
    }, 300);
}

function signalSectionDone() {
    if (AppState.ws && AppState.ws.readyState === WebSocket.OPEN) {
        AppState.ws.send(JSON.stringify({ action: 'section_done' }));
    }
}

// ============================================================================
// Image Display
// ============================================================================
function normalizeImagePath(imagePath) {
    let normalized = imagePath;

    // Handle product-specific paths: output/products/{id}/images/{filename}
    const productMatch = normalized.match(/output[\/\\]products[\/\\](\d+)[\/\\]images[\/\\](.+)/);
    if (productMatch) {
        const result = `/products/${productMatch[1]}/images/${productMatch[2]}`;
        console.log(`[Image] Normalized (product path): ${imagePath} -> ${result}`);
        return result;
    }

    // Handle legacy paths: output/images/{filename}
    if (normalized.startsWith('output/images/')) {
        normalized = normalized.replace('output/images/', '');
    } else if (normalized.startsWith('output\\images\\')) {
        normalized = normalized.replace('output\\images\\', '');
    }

    // If we have a selected product, use product-specific path
    if (AppState.selectedProduct && AppState.selectedProduct.id) {
        const result = `/products/${AppState.selectedProduct.id}/images/${normalized}`;
        console.log(`[Image] Normalized (selected product): ${imagePath} -> ${result}`);
        return result;
    }

    const result = `/images/${normalized}`;
    console.log(`[Image] Normalized (legacy): ${imagePath} -> ${result}`);
    return result;
}

function displayImage(imagePath, index) {
    if (!imagePath) {
        resetImageDisplay();
        return;
    }

    // Always show single image (one at a time, not grid)
    // Thumbnail strip is hidden - images change automatically

    // Remove any existing grid
    const existingGrid = elements.imageDisplay.querySelector('.image-grid');
    if (existingGrid) existingGrid.remove();

    const imageUrl = normalizeImagePath(imagePath);

    // Clear existing content
    const existingContent = elements.imageDisplay.querySelectorAll('img, .image-grid, .image-loading');
    existingContent.forEach(el => el.remove());
    const placeholder = elements.imageDisplay.querySelector('.image-placeholder');
    if (placeholder) placeholder.remove();

    // Show loading spinner immediately
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'image-loading';
    loadingDiv.innerHTML = '<div class="image-spinner"><i class="fas fa-spinner fa-spin"></i></div><p>Loading image...</p>';
    elements.imageDisplay.appendChild(loadingDiv);

    const bgImg = document.createElement('img');
    bgImg.src = imageUrl;
    bgImg.className = 'image-bg-blur';
    bgImg.alt = '';
    bgImg.loading = 'eager';
    bgImg.decoding = 'async';

    const mainImg = document.createElement('img');
    mainImg.src = imageUrl;
    mainImg.className = 'image-main';
    mainImg.alt = 'Presentation image';
    mainImg.style.cursor = 'pointer';
    mainImg.loading = 'eager';
    mainImg.decoding = 'async';
    mainImg.onclick = () => openImageViewer(imageUrl, index, AppState.currentImages);

    // Wait for image to be fully decoded before showing
    mainImg.decode().then(() => {
        loadingDiv.remove();
        elements.imageDisplay.appendChild(bgImg);
        elements.imageDisplay.appendChild(mainImg);
    }).catch(() => {
        loadingDiv.remove();
        elements.imageDisplay.appendChild(bgImg);
        elements.imageDisplay.appendChild(mainImg);
    });

    bgImg.onerror = () => {}; // Silently fail for background blur
    mainImg.onerror = () => {
        console.log(`[Image] Failed to load (deleted?): ${imageUrl}, skipping to next`);

        // Remove this failed image from the array
        AppState.currentImages.splice(index, 1);

        // Remove loading indicator
        if (loadingDiv && loadingDiv.parentNode) {
            loadingDiv.remove();
        }

        // Try to show next image
        if (AppState.currentImages.length > 0) {
            // Adjust index if needed
            const nextIndex = index < AppState.currentImages.length ? index : 0;
            displayImage(AppState.currentImages[nextIndex], nextIndex);
        } else {
            // No images left, show placeholder
            resetImageDisplay();
        }
    };

    // Show image counter if multiple images
    if (AppState.currentImages.length > 1) {
        elements.imageCounter.textContent = `${index + 1} / ${AppState.currentImages.length}`;
        elements.imageCounter.style.opacity = '1';
    } else {
        elements.imageCounter.style.opacity = '0';
    }
}

function displayImagesGrid(images, activeIndex = 0) {
    // Clear existing content
    const placeholder = elements.imageDisplay.querySelector('.image-placeholder');
    if (placeholder) placeholder.remove();

    const existingGrid = elements.imageDisplay.querySelector('.image-grid');
    const existingImages = elements.imageDisplay.querySelectorAll('.image-bg-blur, .image-main');
    existingImages.forEach(img => img.remove());

    // Hide thumbnail strip when showing grid
    elements.thumbnailStrip.style.display = 'none';

    // Determine grid class based on image count
    const count = Math.min(images.length, 6); // Max 6 images in grid
    let gridClass = 'image-grid';
    if (count === 1) gridClass += ' grid-1';
    else if (count === 2) gridClass += ' grid-2';
    else if (count === 3) gridClass += ' grid-3';
    else if (count === 4) gridClass += ' grid-4';
    else gridClass += ' grid-many';

    // Create or update grid
    let grid = existingGrid;
    if (!grid) {
        grid = document.createElement('div');
        grid.className = gridClass;
        elements.imageDisplay.appendChild(grid);
    } else {
        grid.className = gridClass;
        grid.innerHTML = '';
    }

    // Add images to grid
    const imageList = images.slice(0, 6);
    const totalImages = imageList.length;
    let loadedCount = 0;
    let failedCount = 0;

    const updateCounter = () => {
        const visible = loadedCount;
        if (visible > 0) {
            elements.imageCounter.textContent = `${visible} image${visible > 1 ? 's' : ''}`;
            // Update grid class based on visible images
            grid.className = 'image-grid';
            if (visible === 1) grid.classList.add('grid-1');
            else if (visible === 2) grid.classList.add('grid-2');
            else if (visible === 3) grid.classList.add('grid-3');
            else if (visible === 4) grid.classList.add('grid-4');
            else if (visible === 5) grid.classList.add('grid-5');
            else grid.classList.add('grid-many');
        } else if (loadedCount + failedCount === totalImages) {
            // All images processed and none loaded - show placeholder
            resetImageDisplay();
        }
    };

    imageList.forEach((imagePath, index) => {
        const imageUrl = normalizeImagePath(imagePath);

        const gridItem = document.createElement('div');
        gridItem.className = `grid-image ${index === activeIndex ? 'active' : ''}`;
        gridItem.onclick = () => openImageViewer(imageUrl, index, images);

        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = `Image ${index + 1}`;
        img.loading = 'eager';
        img.decoding = 'async';

        // Hide grid item if image fails to load (deleted)
        img.onerror = () => {
            console.log(`[Grid] Image failed to load (deleted?): ${imageUrl}`);
            gridItem.style.display = 'none';
            failedCount++;
            updateCounter();
        };

        img.onload = () => {
            loadedCount++;
            updateCounter();
        };

        const numberBadge = document.createElement('span');
        numberBadge.className = 'grid-image-number';
        numberBadge.textContent = index + 1;

        gridItem.appendChild(img);
        gridItem.appendChild(numberBadge);
        grid.appendChild(gridItem);
    });

    // Counter will be updated by onload/onerror handlers
    elements.imageCounter.textContent = 'Loading...';
    elements.imageCounter.style.opacity = '1';
}

function openImageViewer(imageUrl, currentIndex, allImages) {
    // Create fullscreen image viewer
    const viewer = document.createElement('div');
    viewer.className = 'image-viewer';
    viewer.innerHTML = `
        <div class="viewer-backdrop"></div>
        <div class="viewer-content">
            <img src="${imageUrl}" alt="Full size image" class="viewer-image">
            <div class="viewer-controls">
                <button class="viewer-btn viewer-prev" ${currentIndex === 0 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i>
                </button>
                <span class="viewer-counter">${currentIndex + 1} / ${allImages.length}</span>
                <button class="viewer-btn viewer-next" ${currentIndex === allImages.length - 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <button class="viewer-close">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    // Close on backdrop click
    viewer.querySelector('.viewer-backdrop').onclick = () => viewer.remove();
    viewer.querySelector('.viewer-close').onclick = () => viewer.remove();

    // Navigation
    const viewerImage = viewer.querySelector('.viewer-image');
    const viewerCounter = viewer.querySelector('.viewer-counter');
    const prevBtn = viewer.querySelector('.viewer-prev');
    const nextBtn = viewer.querySelector('.viewer-next');

    let viewerIndex = currentIndex;

    const updateViewer = () => {
        const newUrl = normalizeImagePath(allImages[viewerIndex]);
        viewerImage.src = newUrl;
        viewerCounter.textContent = `${viewerIndex + 1} / ${allImages.length}`;
        prevBtn.disabled = viewerIndex === 0;
        nextBtn.disabled = viewerIndex === allImages.length - 1;
    };

    prevBtn.onclick = (e) => {
        e.stopPropagation();
        if (viewerIndex > 0) {
            viewerIndex--;
            updateViewer();
        }
    };

    nextBtn.onclick = (e) => {
        e.stopPropagation();
        if (viewerIndex < allImages.length - 1) {
            viewerIndex++;
            updateViewer();
        }
    };

    // Keyboard navigation
    const handleKeydown = (e) => {
        if (e.key === 'Escape') viewer.remove();
        if (e.key === 'ArrowLeft' && viewerIndex > 0) {
            viewerIndex--;
            updateViewer();
        }
        if (e.key === 'ArrowRight' && viewerIndex < allImages.length - 1) {
            viewerIndex++;
            updateViewer();
        }
    };

    document.addEventListener('keydown', handleKeydown);
    viewer.addEventListener('remove', () => document.removeEventListener('keydown', handleKeydown));

    // Remove listener when viewer is removed
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.removedNodes.forEach((node) => {
                if (node === viewer) {
                    document.removeEventListener('keydown', handleKeydown);
                    observer.disconnect();
                }
            });
        });
    });
    observer.observe(document.body, { childList: true });

    document.body.appendChild(viewer);

    // Animate in
    requestAnimationFrame(() => viewer.classList.add('active'));
}

function resetImageDisplay() {
    elements.imageDisplay.innerHTML = `
        <div class="image-placeholder">
            <i class="fas fa-images"></i>
            <p>No images to display</p>
        </div>
    `;
    elements.imageCounter.textContent = '';
    elements.imageCounter.style.opacity = '0';
}

function displayReferenceImagesInPanel(references) {
    const allImages = [];
    for (const ref of references) {
        if (ref.images && ref.images.length > 0) {
            for (const img of ref.images) {
                if (allImages.length >= 6) break;
                allImages.push({ path: img, page: ref.page });
            }
        }
        if (allImages.length >= 6) break;
    }

    if (allImages.length === 0) return;

    AppState.currentImages = allImages.map(img => img.path);
    AppState.referenceImages = allImages;
    AppState.currentImageIndex = 0;

    // Display all images in a grid
    displayImagesGrid(AppState.currentImages, 0);

    elements.imageCounter.textContent = `${allImages.length} image${allImages.length > 1 ? 's' : ''} from references`;
    elements.imageCounter.style.opacity = '1';
}

// ============================================================================
// Audio Utilities
// ============================================================================
function stopAudio() {
    elements.audioPlayer.pause();
    elements.audioPlayer.currentTime = 0;
    elements.audioPlayer.src = '';  // Clear source completely
    AppState.isAudioPlaying = false;
    console.log('[Audio] Presentation audio stopped and cleared');
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Speech-to-Text (Web Speech API)
// ============================================================================
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        AppState.finalTranscript += finalTranscript;
        elements.chatInput.value = AppState.finalTranscript + interimTranscript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            showSystemMessage('Microphone access denied.');
        }
        stopVoiceRecording();
    };

    recognition.onend = () => {
        if (AppState.isRecording) {
            try {
                recognition.start();
            } catch (e) {
                stopVoiceRecording();
            }
        }
    };

    return recognition;
}

async function toggleVoiceRecording() {
    if (AppState.isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

async function startVoiceRecording() {
    try {
        if (!AppState.speechRecognition) {
            AppState.speechRecognition = initSpeechRecognition();
        }

        if (!AppState.speechRecognition) {
            showSystemMessage('Speech recognition not supported.');
            return;
        }

        AppState.finalTranscript = '';
        elements.chatInput.value = '';

        AppState.speechRecognition.start();
        AppState.isRecording = true;

        elements.voiceBtn.classList.add('recording');
        elements.voiceIndicator.style.display = 'flex';

        if (AppState.isPlaying && !AppState.isPaused) {
            await interruptPresentation();
        }
    } catch (error) {
        console.error('Speech recognition error:', error);
        showSystemMessage('Failed to start voice recognition.');
    }
}

function stopVoiceRecording() {
    if (AppState.speechRecognition && AppState.isRecording) {
        AppState.speechRecognition.stop();
        AppState.isRecording = false;
        elements.voiceBtn.classList.remove('recording');
        elements.voiceIndicator.style.display = 'none';

        if (elements.chatInput.value.trim()) {
            elements.chatInput.focus();
        }
    }
}

function cancelVoiceRecording() {
    if (AppState.speechRecognition && AppState.isRecording) {
        AppState.speechRecognition.stop();
        AppState.isRecording = false;
        AppState.finalTranscript = '';
        elements.chatInput.value = '';
        elements.voiceBtn.classList.remove('recording');
        elements.voiceIndicator.style.display = 'none';
    }
}

// ============================================================================
// Chat Functionality
// ============================================================================
function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendClick();
    }
}

function handleSendClick() {
    const message = elements.chatInput.value.trim();
    if (!message) return;

    // Add user message to chat
    addUserMessageSimple(message);
    elements.chatInput.value = '';

    // Check if still in registration flow
    if (RegistrationState.step !== 'complete') {
        handleRegistrationInput(message);
    } else {
        // Normal chat - send to API
        sendMessageToAPI(message);
    }
}

async function handleChatInput() {
    if (elements.chatInput.value.length === 1 && AppState.isPlaying && !AppState.isPaused) {
        await interruptPresentation();
    }
}

async function interruptPresentation() {
    // Set flags IMMEDIATELY before any async operations
    AppState.isPaused = true;
    AppState.isChatActive = true;
    updatePlayPauseButton();
    updateStatus('paused');
    stopAudio();
    console.log('[Interrupt] Paused and chat active - blocking all presentation audio');

    try {
        await fetch('/api/presentation/interrupt', { method: 'POST' });
        clearWordTimers();
    } catch (error) {
        console.error('Interrupt error:', error);
    }
}

// Show loading state in chat input area
function setChatLoading(isLoading) {
    if (isLoading) {
        elements.chatInput.disabled = true;
        elements.chatInput.placeholder = 'Waiting for response...';
        elements.sendBtn.disabled = true;
        elements.sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        elements.sendBtn.classList.add('loading');
    } else {
        elements.chatInput.disabled = false;
        elements.chatInput.placeholder = 'Type your message...';
        elements.sendBtn.disabled = false;
        elements.sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        elements.sendBtn.classList.remove('loading');
        elements.chatInput.focus();
    }
}

async function sendMessageToAPI(message) {
    if (AppState.isRecording) {
        stopVoiceRecording();
    }

    // Mark chat as active - blocks all presentation audio
    AppState.isChatActive = true;
    console.log('[Chat] Active - blocking presentation audio');

    AppState.finalTranscript = '';
    setChatLoading(true);  // Show loading in input area
    showTypingIndicator();

    try {
        const chatPayload = { message };
        // Include user_id if registered
        if (AppState.userInfo && AppState.userInfo.id) {
            chatPayload.user_id = AppState.userInfo.id;
        }

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatPayload)
        });

        const data = await response.json();
        removeTypingIndicator();
        setChatLoading(false);  // Remove loading state

        if (data.response) {
            const references = data.references || [];
            addChatMessage(data.response, 'assistant', references);

            if (references.length > 0) {
                displayReferenceImagesInPanel(references);
            }

            // Use chat-specific TTS enabled flag (not presentation TTS)
            if (AppState.chatTtsEnabled) {
                const plainText = data.response.replace(/[#*`\[\]()]/g, '').replace(/\n+/g, ' ');
                speakChatResponse(plainText);
            } else {
                // Chat TTS muted - clear active flag immediately
                AppState.isChatActive = false;
                console.log('[Chat] TTS muted - chat inactive');
            }

            // Don't auto-resume presentation while chat audio might be playing
            // The onChatAudioEnded handler will resume if needed
        }
    } catch (error) {
        console.error('Chat error:', error);
        AppState.isChatActive = false;  // Clear on error
        removeTypingIndicator();
        setChatLoading(false);  // Remove loading state
        addBotMessage('Sorry, an error occurred. Please try again.');
    }
}

async function speakChatResponse(text, messageElement = null) {
    // Check if chat TTS is muted
    if (!AppState.chatTtsEnabled) {
        console.log('[Chat TTS] Muted - skipping');
        return;
    }

    try {
        // Set chat audio flag FIRST to block any presentation audio
        AppState.isChatAudioPlaying = true;
        console.log('[Chat TTS] Chat audio flag set - blocking presentation');

        // AGGRESSIVELY stop and clear presentation audio
        elements.audioPlayer.pause();
        elements.audioPlayer.currentTime = 0;
        elements.audioPlayer.src = '';  // Clear the source completely
        AppState.isAudioPlaying = false;

        // Fetch TTS for chat response
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice: AppState.ttsVoice })
        });

        const data = await response.json();

        if (data.audio) {
            const audioBlob = base64ToBlob(data.audio, 'audio/mp3');
            const audioUrl = URL.createObjectURL(audioBlob);

            // Use separate chat audio player
            elements.chatAudioPlayer.src = audioUrl;
            elements.chatAudioPlayer.playbackRate = AppState.presentationSpeed;

            // Store message element for potential text sync
            AppState.currentChatMessage = messageElement;
            AppState.currentChatText = text;

            // Get audio duration (for logging)
            elements.chatAudioPlayer.onloadedmetadata = () => {
                const duration = elements.chatAudioPlayer.duration;
                AppState.chatAudioDuration = duration;
                console.log(`[Chat TTS] Audio duration: ${duration.toFixed(2)}s`);
                // Grid display - all images shown at once
            };

            elements.chatAudioPlayer.play();
            // isChatAudioPlaying already set at start of function
            console.log('[Chat TTS] Playing response');
        } else {
            // No audio returned - clear flags
            AppState.isChatAudioPlaying = false;
            AppState.isChatActive = false;
            console.log('[Chat TTS] No audio returned - flags cleared');
        }
    } catch (error) {
        console.error('[Chat TTS] Error:', error);
        AppState.isChatAudioPlaying = false;
        AppState.isChatActive = false;
    }
}

// Stop chat audio (for when presentation needs to resume or user wants to stop)
function stopChatAudio() {
    if (AppState.isChatAudioPlaying) {
        elements.chatAudioPlayer.pause();
        elements.chatAudioPlayer.currentTime = 0;
        AppState.isChatAudioPlaying = false;
        AppState.isChatActive = false;
        clearChatImageTimers();
        console.log('[Chat TTS] Stopped - chat inactive');
    }
}

// When chat audio ends
function onChatAudioEnded() {
    AppState.isChatAudioPlaying = false;
    AppState.isChatActive = false;
    AppState.currentChatMessage = null;
    AppState.currentChatText = '';
    AppState.presentationPausedForChat = false;
    clearChatImageTimers();
    console.log('[Chat TTS] Finished - user can click play to resume presentation');
    // NO auto-resume - user must click play button to continue presentation
}

// When chat audio fails to load
function onChatAudioError(e) {
    console.error('[Chat TTS] Audio error:', e);
    AppState.isChatAudioPlaying = false;
    AppState.isChatActive = false;
    AppState.currentChatMessage = null;
    AppState.currentChatText = '';
    clearChatImageTimers();
}

// Toggle chat voice mute
function toggleChatMute() {
    AppState.chatTtsEnabled = !AppState.chatTtsEnabled;

    // Update icon and button style
    if (AppState.chatTtsEnabled) {
        elements.chatMuteIcon.className = 'fas fa-volume-up';
        elements.chatMuteBtn.title = 'Mute Chat Voice';
        elements.chatMuteBtn.classList.remove('muted');
    } else {
        elements.chatMuteIcon.className = 'fas fa-volume-mute';
        elements.chatMuteBtn.title = 'Unmute Chat Voice';
        elements.chatMuteBtn.classList.add('muted');
        // Stop any playing chat audio when muting
        stopChatAudio();
    }

    // Save preference
    saveSettings();
    console.log('[Chat TTS] Mute:', !AppState.chatTtsEnabled);
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addChatMessage(content, type, references = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = type === 'user'
        ? '<i class="fas fa-user"></i>'
        : '<i class="fas fa-robot"></i>';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (type === 'user') {
        contentDiv.innerHTML = `<p>${escapeHtml(content)}</p>`;
    } else if (type === 'assistant') {
        const renderedMarkdown = marked.parse(content);
        contentDiv.innerHTML = `<div class="markdown-content">${renderedMarkdown}</div>`;

        if (references && references.length > 0) {
            const hasImages = references.some(ref => ref.images && ref.images.length > 0);
            if (hasImages) {
                let refHtml = `<div class="reference-images">`;
                refHtml += `<div class="reference-header"><i class="fas fa-images"></i> Related Images</div>`;
                refHtml += `<div class="reference-gallery">`;
                let imageCount = 0;
                const maxImages = 3;
                outerLoop:
                for (const ref of references) {
                    if (ref.images && ref.images.length > 0) {
                        for (const img of ref.images) {
                            if (imageCount >= maxImages) break outerLoop;
                            let imagePath = img;
                            if (imagePath.startsWith('output/images/')) {
                                imagePath = imagePath.replace('output/images/', '');
                            } else if (imagePath.startsWith('output\\images\\')) {
                                imagePath = imagePath.replace('output\\images\\', '');
                            }
                            const imageUrl = `/images/${imagePath}`;
                            refHtml += `
                                <div class="reference-image-card">
                                    <img src="${imageUrl}" alt="Page ${ref.page}" loading="lazy" onclick="showImageModal('${imageUrl}')">
                                    <span class="page-badge">Page ${ref.page}</span>
                                </div>
                            `;
                            imageCount++;
                        }
                    }
                }
                refHtml += `</div></div>`;
                contentDiv.innerHTML += refHtml;
            }
        }
    } else {
        contentDiv.innerHTML = `<p>${escapeHtml(content)}</p>`;
    }

    const timeDiv = document.createElement('span');
    timeDiv.className = 'message-time';
    timeDiv.textContent = formatTime(new Date());

    wrapper.appendChild(contentDiv);
    wrapper.appendChild(timeDiv);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(wrapper);

    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function showImageModal(imageUrl) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content">
            <img src="${imageUrl}" alt="Full size image">
            <button class="image-modal-close"><i class="fas fa-times"></i></button>
        </div>
    `;
    modal.onclick = (e) => {
        if (e.target === modal || e.target.closest('.image-modal-close')) {
            modal.remove();
        }
    };
    document.body.appendChild(modal);
}

function showSystemMessage(content) {
    addChatMessage(content, 'system');
}

function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message assistant';
    indicator.id = 'typingIndicator';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = `
        <div class="typing-indicator">
            <span></span><span></span><span></span>
        </div>
    `;

    wrapper.appendChild(contentDiv);
    indicator.appendChild(avatar);
    indicator.appendChild(wrapper);

    elements.chatMessages.appendChild(indicator);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// UI Updates
// ============================================================================
function updatePlayPauseButton() {
    elements.playPauseIcon.className = (AppState.isPlaying && !AppState.isPaused)
        ? 'fas fa-pause'
        : 'fas fa-play';
}

function updateStatus(status) {
    elements.statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    elements.statusBadge.className = `status-badge ${status}`;
}

function updateProgress() {
    const progress = AppState.totalSections > 0
        ? ((AppState.currentSection + 1) / AppState.totalSections) * 100
        : 0;

    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `Section ${AppState.currentSection + 1} of ${AppState.totalSections}`;
}

// ============================================================================
// Settings
// ============================================================================
async function loadSettings() {
    // Fetch settings from server (admin-controlled)
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();

        AppState.ttsEnabled = settings.ttsEnabled ?? true;
        AppState.ttsVoice = settings.ttsVoice ?? 'asteria';
        AppState.presentationSpeed = settings.presentationSpeed ?? 1;
        AppState.sectionDelay = settings.sectionDelay ?? 0.5;

        // Update UI elements if they exist
        if (elements.autoTTS) elements.autoTTS.checked = AppState.ttsEnabled;
        if (elements.voiceSelect) elements.voiceSelect.value = AppState.ttsVoice;
        if (elements.speedSlider) {
            elements.speedSlider.value = AppState.presentationSpeed;
            if (elements.speedValue) elements.speedValue.textContent = `${AppState.presentationSpeed}x`;
        }
        if (elements.sectionDelay) elements.sectionDelay.value = AppState.sectionDelay;

        console.log('Settings loaded from server:', settings);
    } catch (error) {
        console.error('Failed to load settings from server, using defaults:', error);
        // Use defaults if server fails
        AppState.ttsEnabled = true;
        AppState.ttsVoice = 'asteria';
        AppState.presentationSpeed = 1;
        AppState.sectionDelay = 0.5;
    }
}

function saveSettings() {
    localStorage.setItem('presentationSettings', JSON.stringify({
        ttsEnabled: AppState.ttsEnabled,
        ttsVoice: AppState.ttsVoice,
        presentationSpeed: AppState.presentationSpeed,
        sectionDelay: AppState.sectionDelay,
        voiceOnlyMode: AppState.voiceOnlyMode,
        chatTtsEnabled: AppState.chatTtsEnabled
    }));
}

// Load chat TTS setting from localStorage (user preference)
function loadChatTtsSettings() {
    try {
        const saved = localStorage.getItem('presentationSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            if (settings.chatTtsEnabled !== undefined) {
                AppState.chatTtsEnabled = settings.chatTtsEnabled;
                // Update UI
                if (!AppState.chatTtsEnabled) {
                    elements.chatMuteIcon.className = 'fas fa-volume-mute';
                    elements.chatMuteBtn.title = 'Unmute Chat Voice';
                    elements.chatMuteBtn.classList.add('muted');
                }
            }
        }
    } catch (e) {
        console.log('Could not load chat TTS settings');
    }
}

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', init);
