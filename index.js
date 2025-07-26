const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration - Updated with your details
const CONFIG = {
    TIDYCAL_API_KEY: process.env.TIDYCAL_API_KEY || 'YOUR_TIDYCAL_API_KEY_HERE',
    SUBSTACK_URL: 'https://studiogrowth.substack.com',
    CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes
    LOG_FILE: 'sync_log.txt'
};

// Store last check time
let lastCheckTime = new Date();

// Function to log activities
async function logActivity(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(message);
    
    try {
        await fs.appendFile(CONFIG.LOG_FILE, logMessage);
    } catch (error) {
        console.error('Failed to write to log file:', error);
    }
}

// Function to get new TidyCal bookings
async function getNewBookings() {
    try {
        const response = await axios.get('https://api.tidycal.com/bookings', {
            headers: {
                'Authorization': `Bearer ${CONFIG.TIDYCAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: {
                starts_at: lastCheckTime.toISOString()
            }
        });

        return response.data.data || [];
    } catch (error) {
        await logActivity(`Error fetching TidyCal bookings: ${error.message}`);
        return [];
    }
}

// Function to subscribe email to Substack
async function subscribeToSubstack(email, name) {
    try {
        // Using the unofficial but reliable method
        const response = await axios.post(`${CONFIG.SUBSTACK_URL}/api/v1/free`, {
            email: email,
            name: name || '',
            source: 'embed'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; TidyCal-Substack-Integration)',
                'Origin': CONFIG.SUBSTACK_URL,
                'Referer': CONFIG.SUBSTACK_URL
            }
        });

        return response.status === 200;
    } catch (error) {
        await logActivity(`Error subscribing ${email} to Substack: ${error.message}`);
        return false;
    }
}

// Main sync function
async function syncBookingsToSubstack() {
    await logActivity('Starting sync check...');
    
    const newBookings = await getNewBookings();
    
    if (newBookings.length === 0) {
        await logActivity('No new bookings found');
        return;
    }

    await logActivity(`Found ${newBookings.length} new booking(s)`);

    for (const booking of newBookings) {
        const { contact } = booking;
        const email = contact.email;
        const name = contact.name;

        await logActivity(`Processing booking: ${name} (${email})`);

        const success = await subscribeToSubstack(email, name);
        
        if (success) {
            await logActivity(`✅ Successfully added ${email} to Substack`);
        } else {
            await logActivity(`❌ Failed to add ${email} to Substack`);
        }

        // Small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update last check time
    lastCheckTime = new Date();
    await logActivity(`Sync completed. Next check in ${CONFIG.CHECK_INTERVAL / 60000} minutes.`);
}

// Start the periodic sync
setInterval(syncBookingsToSubstack, CONFIG.CHECK_INTERVAL);

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        lastCheck: lastCheckTime,
        nextCheck: new Date(Date.now() + CONFIG.CHECK_INTERVAL)
    });
});

// Manual sync endpoint
app.get('/sync', async (req, res) => {
    await syncBookingsToSubstack();
    res.json({ message: 'Sync completed' });
});

// Log viewer endpoint
app.get('/logs', async (req, res) => {
    try {
        const logs = await fs.readFile(CONFIG.LOG_FILE, 'utf8');
        res.send(`<pre>${logs}</pre>`);
    } catch (error) {
        res.send('No logs available yet');
    }
});

app.listen(PORT, () => {
    console.log(`TidyCal-Substack sync running on port ${PORT}`);
    logActivity('🚀 TidyCal-Substack automation started');
    
    // Run initial sync
    setTimeout(syncBookingsToSubstack, 5000);
});
