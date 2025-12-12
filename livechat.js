(function() {
    const API_BASE_URL = 'https://api.fortyx.net/api';

    let chatState = {
        isOpen: false,
        sessionId: null,
        userEmail: null,
        hasSubmittedFirstMessage: false,
        pollInterval: null,
        lastMessageTimestamp: null,
        ticketClosed: false
    };

    const chatToggle = document.getElementById('chatToggle');
    const chatWindow = document.getElementById('chatWindow');
    const chatClose = document.getElementById('chatClose');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const chatSend = document.getElementById('chatSend');
    const emailPrompt = document.getElementById('emailPrompt');
    const chatEmail = document.getElementById('chatEmail');
    const submitEmail = document.getElementById('submitEmail');
    const chatInputContainer = document.getElementById('chatInputContainer');
    const chatIcon = document.querySelector('.chat-icon');
    const closeIcon = document.querySelector('.close-icon');
    const notificationBadge = document.getElementById('chatNotificationBadge');

    function initSession() {
        let sessionId = localStorage.getItem('chatSessionId');
        if (!sessionId) {
            sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('chatSessionId', sessionId);
        }
        chatState.sessionId = sessionId;

        const storedEmail = localStorage.getItem('chatUserEmail');
        if (storedEmail) {
            chatState.userEmail = storedEmail;
            chatState.hasSubmittedFirstMessage = true;
        }

        loadChatHistory();
    }

    function toggleChat() {
        chatState.isOpen = !chatState.isOpen;

        if (chatState.isOpen) {
            chatWindow.style.display = 'flex';
            chatIcon.style.display = 'none';
            closeIcon.style.display = 'block';
            notificationBadge.style.display = 'none';

            startPolling();

            setTimeout(() => {
                if (chatState.userEmail) {
                    chatInput.focus();
                } else if (!chatState.hasSubmittedFirstMessage) {
                    chatInput.focus();
                }
            }, 300);
        } else {
            chatWindow.style.display = 'none';
            chatIcon.style.display = 'block';
            closeIcon.style.display = 'none';

            stopPolling();
        }
    }

    function addMessage(text, isUser = false, timestamp = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${isUser ? 'user-message' : 'bot-message'}`;

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';

        if (isUser) {
            const initial = chatState.userEmail ? chatState.userEmail.charAt(0).toUpperCase() : 'U';
            avatarDiv.textContent = initial;
        } else {
            const img = document.createElement('img');
            img.src = 'logo.ico';
            img.alt = 'FortyX';
            avatarDiv.appendChild(img);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const p = document.createElement('p');
        p.textContent = text;
        contentDiv.appendChild(p);

        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        if (chatState.ticketClosed) {
            return;
        }

        if (!chatState.hasSubmittedFirstMessage) {
            addMessage(message, true);
            chatInput.value = '';

            chatInputContainer.style.display = 'none';
            emailPrompt.style.display = 'block';
            chatState.hasSubmittedFirstMessage = true;

            sessionStorage.setItem('firstMessage', message);

            return;
        }

        if (chatState.userEmail) {
            addMessage(message, true);
            chatInput.value = '';
            chatInput.style.height = 'auto';

            try {
                console.log(`[Network] POST ${API_BASE_URL}/livechat/send`);
                const response = await fetch(`${API_BASE_URL}/livechat/send`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        sessionId: chatState.sessionId,
                        email: chatState.userEmail,
                        message: message
                    })
                });

                const data = await response.json();
                if (!data.success) {
                    addMessage('Failed to send message. Please try again.', false);
                }
            } catch (error) {
                console.error('[Network] Error sending message:', error);
                addMessage('Failed to send message. Please try again.', false);
            }
        }
    }

    async function submitEmailHandler() {
        const email = chatEmail.value.trim();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            alert('Please enter a valid email address');
            return;
        }

        submitEmail.disabled = true;
        submitEmail.textContent = 'Creating ticket...';

        try {
            const firstMessage = sessionStorage.getItem('firstMessage');
            const url = `${API_BASE_URL}/livechat/create`;

            console.log(`[Network] POST ${url}`);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: chatState.sessionId,
                    email: email,
                    initialMessage: firstMessage || 'User opened live chat'
                })
            });

            if (!response.ok) {
                console.error('[Network] Create ticket failed:', response.status);
                alert('Failed to create ticket. Server error. Please try again.');
                submitEmail.disabled = false;
                submitEmail.textContent = 'Continue';
                return;
            }

            const data = await response.json();

            if (data.success) {
                chatState.userEmail = email;
                localStorage.setItem('chatUserEmail', email);

                chatState.lastMessageTimestamp = new Date().toISOString();

                emailPrompt.style.display = 'none';
                chatInputContainer.style.display = 'flex';

                addMessage('Thanks! Your support ticket has been created. Our team will respond shortly.', false);

                sessionStorage.removeItem('firstMessage');

                startPolling();

                setTimeout(() => chatInput.focus(), 100);
            } else {
                console.error('[Network] Server returned error:', data.message);
                alert(data.message || 'Failed to create ticket. Please try again.');
                submitEmail.disabled = false;
                submitEmail.textContent = 'Continue';
            }
        } catch (error) {
            console.error('[Network] Error creating ticket:', error);
            alert('Failed to create ticket. Network error. Please try again.');
            submitEmail.disabled = false;
            submitEmail.textContent = 'Continue';
        }
    }

    async function pollMessages() {
        if (!chatState.userEmail || !chatState.sessionId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/livechat/messages?sessionId=${chatState.sessionId}`);
            const data = await response.json();

            if (data.closed && !chatState.ticketClosed) {
                chatState.ticketClosed = true;
                showTicketClosedMessage();
                stopPolling();
                return;
            }

            if (data.success && data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    if (msg.from === 'support') {
                        if (!chatState.lastMessageTimestamp || msg.timestamp > chatState.lastMessageTimestamp) {
                            addMessage(msg.text, false, msg.timestamp);
                            chatState.lastMessageTimestamp = msg.timestamp;

                            if (!chatState.isOpen) {
                                notificationBadge.style.display = 'flex';
                            }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error polling messages:', error);
        }
    }

    function startPolling() {
        if (chatState.pollInterval) return;

        chatState.pollInterval = setInterval(pollMessages, 3000);

        pollMessages();
    }

    function stopPolling() {
        if (chatState.pollInterval) {
            clearInterval(chatState.pollInterval);
            chatState.pollInterval = null;
        }
    }

    async function loadChatHistory() {
        if (!chatState.sessionId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/livechat/history?sessionId=${chatState.sessionId}`);
            const data = await response.json();

            if (data.success && data.messages && data.messages.length > 0) {
                const welcomeMessage = chatMessages.querySelector('.bot-message');
                chatMessages.innerHTML = '';
                if (welcomeMessage) {
                    chatMessages.appendChild(welcomeMessage);
                }

                data.messages.forEach(msg => {
                    addMessage(msg.text, msg.from === 'user', msg.timestamp);
                });
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    }

    function showTicketClosedMessage() {
        chatInputContainer.style.display = 'none';

        addMessage('This ticket has been closed by our support team.', false);

        const buttonDiv = document.createElement('div');
        buttonDiv.className = 'chat-message bot-message';
        buttonDiv.style.justifyContent = 'center';
        buttonDiv.style.padding = '10px';

        const newTicketBtn = document.createElement('button');
        newTicketBtn.textContent = 'Start New Ticket';
        newTicketBtn.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        `;

        newTicketBtn.onmouseover = function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
        };

        newTicketBtn.onmouseout = function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        };

        newTicketBtn.onclick = startNewTicket;

        buttonDiv.appendChild(newTicketBtn);
        chatMessages.appendChild(buttonDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function startNewTicket() {
        chatState.sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        chatState.hasSubmittedFirstMessage = false;
        chatState.lastMessageTimestamp = null;
        chatState.ticketClosed = false;

        localStorage.setItem('chatSessionId', chatState.sessionId);

        chatMessages.innerHTML = '';

        addMessage('👋 Hello! How can we help you today?', false);

        chatInputContainer.style.display = 'flex';
        chatInput.value = '';
        chatInput.focus();
    }

    function autoResizeTextarea() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    }

    chatToggle.addEventListener('click', toggleChat);
    chatClose.addEventListener('click', toggleChat);

    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', autoResizeTextarea);

    submitEmail.addEventListener('click', submitEmailHandler);
    chatEmail.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitEmailHandler();
        }
    });

    initSession();

    if (chatState.userEmail) {
        startPolling();
    }
})();
