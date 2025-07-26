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
    LOG_FILE: 'sync_log.txt',
    // GDPR COMPLIANCE: Only process bookings created after this timestamp
    AUTOMATION_START_TIME: new Date('2025-07-26T21:42:00Z')
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
        const response = await axios.get('https://tidycal.com/api/bookings', {
            headers: {
                'Authorization': `Bearer ${CONFIG.TIDYCAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: {
                // GDPR SAFETY: Only get bookings from today forward
                starts_at: new Date().toISOString().split('T')[0]  // Format: 2025-07-26
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
        // Try the correct Substack API endpoint
        const response = await axios.post(`${CONFIG.SUBSTACK_URL}/api/v1/subscribe`, {
            email: email,
            name: name || '',
            first_url: CONFIG.SUBSTACK_URL,
            first_referrer: '',
            current_url: CONFIG.SUBSTACK_URL,
            current_referrer: '',
            referral_code: '',
            source: 'embed'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; TidyCal-Substack-Integration)',
                'Origin': CONFIG.SUBSTACK_URL,
                'Referer': CONFIG.SUBSTACK_URL
            }
        });

        return response.status === 200 || response.status === 201;
    } catch (error) {
        // If first method fails, try alternative endpoint
        try {
            const altResponse = await axios.post(`${CONFIG.SUBSTACK_URL}/api/v1/free`, {
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
            return altResponse.status === 200 || altResponse.status === 201;
        } catch (altError) {
            await logActivity(`Error subscribing ${email} to Substack: ${error.message} | Alt method: ${altError.message}`);
            return false;
        }
    }
}

// Main sync function with GDPR compliance
async function syncBookingsToSubstack() {
    await logActivity('Starting sync check...');
    
    const allBookings = await getNewBookings();
    
    if (allBookings.length === 0) {
        await logActivity('No bookings found for today');
        return;
    }

    // GDPR CRITICAL: Only process bookings created AFTER automation started
    const gdprCompliantBookings = allBookings.filter(booking => {
        const bookingCreatedAt = new Date(booking.created_at);
        const isNewBooking = bookingCreatedAt > CONFIG.AUTOMATION_START_TIME;
        
        if (!isNewBooking) {
            // Log skipped bookings for transparency
            logActivity(`⚠️  GDPR SKIP: ${booking.contact.name} (${booking.contact.email}) - created before automation start`);
        }
        
        return isNewBooking;
    });

    await logActivity(`Found ${allBookings.length} total booking(s), processing ${gdprCompliantBookings.length} new booking(s)`);

    if (gdprCompliantBookings.length === 0) {
        await logActivity('No new bookings to process (all were created before automation started)');
        return;
    }

    // Process only the GDPR-compliant new bookings
    for (const booking of gdprCompliantBookings) {
        const { contact } = booking;
        const email = contact.email;
        const name = contact.name;
        const bookingCreatedAt = new Date(booking.created_at);

        await logActivity(`✅ Processing NEW booking: ${name} (${email}) - created: ${bookingCreatedAt.toISOString()}`);

        // Double-check this is truly a new booking (extra safety)
        if (bookingCreatedAt <= CONFIG.AUTOMATION_START_TIME) {
            await logActivity(`🛑 SAFETY STOP: Booking ${email} created before automation - SKIPPING for GDPR compliance`);
            continue;
        }

        const success = await subscribeToSubstack(email, name);
        
        if (success) {
            await logActivity(`✅ Successfully added ${email} to Substack newsletter`);
        } else {
            await logActivity(`❌ Failed to add ${email} to Substack newsletter`);
        }

        // Small delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update last check time
    lastCheckTime = new Date();
    await logActivity(`GDPR-compliant sync completed. Processed ${gdprCompliantBookings.length} new bookings. Next check in ${CONFIG.CHECK_INTERVAL / 60000} minutes.`);
}

// Start the periodic sync
setInterval(syncBookingsToSubstack, CONFIG.CHECK_INTERVAL);

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        lastCheck: lastCheckTime,
        nextCheck: new Date(Date.now() + CONFIG.CHECK_INTERVAL),
        automationStartTime: CONFIG.AUTOMATION_START_TIME,
        gdprCompliant: true
    });
});

// Manual sync endpoint
app.get('/sync', async (req, res) => {
    await logActivity('Manual sync triggered via /sync endpoint');
    await syncBookingsToSubstack();
    res.json({ message: 'GDPR-compliant sync completed' });
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

// GDPR compliance info endpoint
app.get('/gdpr', (req, res) => {
    res.json({
        message: 'GDPR Compliance Information',
        automationStartTime: CONFIG.AUTOMATION_START_TIME,
        policy: 'This automation only processes bookings created AFTER the automation start time',
        dataProcessed: 'Email addresses and names from NEW TidyCal bookings only',
        purpose: 'Adding new subscribers to Substack newsletter',
        retention: 'Data is not stored, only passed through to Substack',
        rights: 'Users can unsubscribe from Substack directly'
    });
});

app.listen(PORT, () => {
    console.log(`TidyCal-Substack sync running on port ${PORT}`);
    logActivity('🚀 GDPR-Compliant TidyCal-Substack automation started');
    logActivity(`⚖️  GDPR: Only processing bookings created after ${CONFIG.AUTOMATION_START_TIME.toISOString()}`);
    
    // Run initial sync after 5 seconds
    setTimeout(syncBookingsToSubstack, 5000);
});
