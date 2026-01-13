import fetch from 'node-fetch';

async function simulateWebhook(text: string) {
    const url = 'http://localhost:3000/api/waha/webhook';

    const payload = {
        event: 'message',
        session: 'default',
        payload: {
            id: 'msg_' + Date.now(),
            from: '6281234567890@s.whatsapp.net',
            body: text,
            fromMe: false,
            timestamp: Math.floor(Date.now() / 1000),
            _data: {
                pushName: 'Test User'
            }
        }
    };

    console.log(`Sending webhook payload: "${text}"`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('Response Status:', response.status);
    } catch (error) {
        console.error('Error sending webhook:', error);
    }
}

simulateWebhook('1');
