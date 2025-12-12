require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());
app.use(express.static('.'));
const rateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    message: {
        success: false,
        message: 'Too many requests. Please wait a minute before submitting another rating.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

if (!DISCORD_WEBHOOK_URL) {
    console.error('WARNING: DISCORD_WEBHOOK_URL environment variable not set!');
}

const LIVECHAT_DIR = path.join(__dirname, 'livechat_data');
const LIVECHAT_FILE = path.join(LIVECHAT_DIR, 'chats.json');
if (!fs.existsSync(LIVECHAT_DIR)) {
    fs.mkdirSync(LIVECHAT_DIR, { recursive: true });
}

if (!fs.existsSync(LIVECHAT_FILE)) {
    fs.writeFileSync(LIVECHAT_FILE, JSON.stringify({}, null, 2));
}
function loadChats() {
    try {
        const data = fs.readFileSync(LIVECHAT_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading chats:', error);
        return {};
    }
}

function saveChats(chats) {
    try {
        fs.writeFileSync(LIVECHAT_FILE, JSON.stringify(chats, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving chats:', error);
        return false;
    }
}

app.post('/api/submit-rating', rateLimiter, async (req, res) => {
    try {
        const { rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Invalid rating. Please select 1-5 stars.'
            });
        }

        if (!comment || comment.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a comment with your rating.'
            });
        }

        if (comment.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'Comment is too long. Maximum 500 characters.'
            });
        }

        const clientIP = req.ip || req.connection.remoteAddress;
        const timestamp = new Date().toISOString();
        const discordPayload = {
            embeds: [{
                title: '⭐ New Rating Submission',
                color: rating >= 4 ? 0x10b981 : rating >= 3 ? 0xf59e0b : 0xef4444,
                fields: [
                    {
                        name: 'Rating',
                        value: '⭐'.repeat(rating) + '☆'.repeat(5 - rating) + ` (${rating}/5)`,
                        inline: false
                    },
                    {
                        name: 'Comment',
                        value: comment.substring(0, 1024),
                        inline: false
                    }
                ],
                footer: {
                    text: `Submitted at ${timestamp}`
                },
                timestamp: timestamp
            }]
        };
        if (DISCORD_WEBHOOK_URL) {
            const response = await fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(discordPayload)
            });

            if (!response.ok) {
                console.error('Discord webhook failed:', response.status);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to submit rating. Please try again later.'
                });
            }
        } else {
            console.log('Rating submitted (no webhook configured):', { rating, comment, clientIP, timestamp });
        }

        res.json({
            success: true,
            message: 'Thank you for your rating!'
        });

    } catch (error) {
        console.error('Error submitting rating:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred. Please try again later.'
        });
    }
});

app.post('/api/livechat/create', async (req, res) => {
    try {
        const { sessionId, email, initialMessage } = req.body;

        if (!sessionId || !email || !initialMessage) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const chats = loadChats();

        const timestamp = new Date().toISOString();
        chats[sessionId] = {
            email: email,
            createdAt: timestamp,
            messages: [
                {
                    from: 'user',
                    text: initialMessage,
                    timestamp: timestamp
                }
            ],
            discordThreadId: null
        };

        if (!saveChats(chats)) {
            return res.status(500).json({
                success: false,
                message: 'Failed to save chat'
            });
        }

        let botTicketCreated = false;
        try {
            const botAPIUrl = process.env.BOT_API_URL || 'http://localhost:5000';
            console.log(`[LiveChat] Attempting to create ticket via bot API: ${botAPIUrl}`);

            const botResponse = await fetch(`${botAPIUrl}/create-livechat-ticket`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: sessionId,
                    email: email,
                    initialMessage: initialMessage
                })
            });

            const botData = await botResponse.json();
            console.log('[LiveChat] Bot API response:', botData);

            if (botData.success) {
                botTicketCreated = true;
                console.log('[LiveChat] Ticket channel created successfully:', botData.channelId);
            }
        } catch (error) {
            console.error('[LiveChat] Error creating ticket via bot API:', error.message);
        }

        if (DISCORD_WEBHOOK_URL && !botTicketCreated) {
            try {
                console.log('[LiveChat] Sending to webhook as fallback');
                const discordPayload = {
                    embeds: [{
                        title: '💬 New Live Chat Ticket',
                        color: 0x5865F2,
                        fields: [
                            {
                                name: 'Email',
                                value: email,
                                inline: true
                            },
                            {
                                name: 'Session ID',
                                value: sessionId,
                                inline: true
                            },
                            {
                                name: 'Initial Message',
                                value: initialMessage,
                                inline: false
                            }
                        ],
                        footer: {
                            text: `Created at ${timestamp}`
                        },
                        timestamp: timestamp
                    }]
                };

                const webhookResponse = await fetch(DISCORD_WEBHOOK_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(discordPayload)
                });

                if (webhookResponse.ok) {
                    console.log('[LiveChat] Webhook sent successfully');
                } else {
                    console.error('[LiveChat] Discord webhook failed:', webhookResponse.status);
                }
            } catch (error) {
                console.error('[LiveChat] Error sending to Discord webhook:', error);
            }
        }

        res.json({
            success: true,
            message: 'Chat ticket created successfully'
        });

    } catch (error) {
        console.error('Error creating live chat:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.post('/api/livechat/send', async (req, res) => {
    try {
        const { sessionId, email, message } = req.body;

        if (!sessionId || !email || !message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const chats = loadChats();

        if (!chats[sessionId]) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }

        const timestamp = new Date().toISOString();
        chats[sessionId].messages.push({
            from: 'user',
            text: message,
            timestamp: timestamp
        });

        if (!saveChats(chats)) {
            return res.status(500).json({
                success: false,
                message: 'Failed to save message'
            });
        }

        try {
            const botAPIUrl = process.env.BOT_API_URL || 'http://localhost:5000';
            await fetch(`${botAPIUrl}/send-livechat-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: sessionId,
                    message: message,
                    from: 'user'
                })
            });
        } catch (error) {
            console.error('Error sending message to bot:', error);
            if (DISCORD_WEBHOOK_URL) {
                try {
                    const webhookPayload = {
                        embeds: [{
                            title: '💬 Live Chat Message',
                            color: 0x5865F2,
                            fields: [
                                {
                                    name: 'Email',
                                    value: email,
                                    inline: true
                                },
                                {
                                    name: 'Session ID',
                                    value: sessionId,
                                    inline: true
                                },
                                {
                                    name: 'Message',
                                    value: message,
                                    inline: false
                                }
                            ],
                            timestamp: timestamp
                        }]
                    };

                    await fetch(DISCORD_WEBHOOK_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(webhookPayload)
                    });
                } catch (webhookError) {
                    console.error('Error sending to webhook:', webhookError);
                }
            }
        }

        res.json({
            success: true,
            message: 'Message sent successfully'
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.get('/api/livechat/messages', (req, res) => {
    try {
        const { sessionId } = req.query;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const chats = loadChats();
        const chat = chats[sessionId];

        if (!chat) {
            return res.json({
                success: true,
                messages: []
            });
        }

        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
        const supportMessages = chat.messages.filter(msg =>
            msg.from === 'support' && msg.timestamp > oneMinuteAgo
        );

        res.json({
            success: true,
            messages: supportMessages,
            closed: chat.closed || false
        });

    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.get('/api/livechat/history', (req, res) => {
    try {
        const { sessionId } = req.query;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID required'
            });
        }

        const chats = loadChats();
        const chat = chats[sessionId];

        if (!chat) {
            return res.json({
                success: true,
                messages: []
            });
        }

        res.json({
            success: true,
            messages: chat.messages
        });

    } catch (error) {
        console.error('Error getting history:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.post('/api/livechat/discord-reply', async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        if (!sessionId || !message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const chats = loadChats();

        if (!chats[sessionId]) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }

        const timestamp = new Date().toISOString();
        chats[sessionId].messages.push({
            from: 'support',
            text: message,
            timestamp: timestamp
        });

        if (!saveChats(chats)) {
            return res.status(500).json({
                success: false,
                message: 'Failed to save message'
            });
        }

        res.json({
            success: true,
            message: 'Reply sent successfully'
        });

    } catch (error) {
        console.error('Error sending Discord reply:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.post('/api/livechat/ticket-closed', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Missing sessionId'
            });
        }

        console.log(`[LiveChat] Ticket closed notification received for session: ${sessionId}`);

        const chats = loadChats();

        if (chats[sessionId]) {
            chats[sessionId].closed = true;
            chats[sessionId].closedAt = new Date().toISOString();

            saveChats(chats);
        }

        res.json({
            success: true,
            message: 'Ticket closure recorded'
        });

    } catch (error) {
        console.error('Error handling ticket closure:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred'
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/tos', (req, res) => {
    res.sendFile(__dirname + '/tos.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://37.114.37.18:${PORT}`);
    console.log(`Server accessible at http://0.0.0.0:${PORT}`);
    console.log(`Discord webhook ${DISCORD_WEBHOOK_URL ? 'configured' : 'NOT configured'}`);
});
