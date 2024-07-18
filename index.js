const express = require('express');
const snoowrap = require('snoowrap');
const request = require('request');
const rp = require('request-promise'); // Import request-promise
const cron = require('node-cron');
const fs = require('fs');

const app = express();

// OAuth2 credentials
const clientId = 'clientid';
const clientSecret = 'clientsecret';
const redirectUri = 'http://localhost:3000/auth/callback'; // Redirect URI you set in your Reddit app settings

// Generate a random state string for CSRF protection
const state = Math.random().toString(36).substring(7);

// Construct the authorization URL
const authUrl = `https://www.reddit.com/api/v1/authorize?client_id=${clientId}&response_type=code&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&duration=permanent&scope=read,identity,submit`;

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Route handler for initiating OAuth2 flow
app.get('/auth/reddit', (req, res) => {
    res.redirect(authUrl);
});

// Route handler for handling OAuth2 callback
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const stateReceived = req.query.state;

    if (stateReceived !== state) {
        return res.status(400).send('State mismatch error');
    }

    if (!code) {
        return res.status(400).send('Authorization code missing');
    }

    const options = {
        method: 'POST',
        uri: 'https://www.reddit.com/api/v1/access_token',
        auth: {
            user: clientId,
            pass: clientSecret,
        },
        form: {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
        },
        headers: {
            'User-Agent': 'MyRedditBot/1.0.0',
        },
        json: true,
    };

    try {
        const response = await rp(options);
        const accessToken = response.access_token;
        const refreshToken = response.refresh_token;
        console.log(`Access token: ${accessToken}`);
        console.log(`Refresh token: ${refreshToken}`);

        // Save tokens to a file
        fs.writeFile('reddit_token.txt', accessToken, (err) => {
            if (err) {
                console.error("Couldn't save token");
            } else {
                console.log('Token saved');
            }
        });

        // Initialize snoowrap with OAuth2 credentials
        const r = new snoowrap({
            userAgent: 'MyRedditBot/1.0.0',
            accessToken: accessToken,
            refreshToken: refreshToken,
            clientId: clientId,
            clientSecret: clientSecret,
        });

        // Start cron job
        startCronJob(r);

        res.send('Authenticated! You can close this window now.');
    } catch (error) {
        console.error('Error exchanging code for token:', error);
        res.status(500).send('Authentication failed');
    }
});

// Start the bot
function startCronJob(r) {
    // Define cron job schedule (every 10 minutes)
    cron.schedule('*/900 * * * *', async () => {
        console.log(`Running bot. Current time: ${new Date().toLocaleTimeString()}`);
        await fetchPostsAndProcessComments(r, ['hot', 'new', 'rising', 'top', 'best']); // Add more types as needed
        await fetchMyComments(r);
        console.log('Bot run completed.');
    });

    // Initial run
    console.log(`Bot started. Running first execution...`);
    fetchPostsAndProcessComments(r, ['hot', 'new', 'rising', 'top', 'best']); // Initial run with specified types
    fetchMyComments(r);
}

// Fetch posts from different types and process comments
async function fetchPostsAndProcessComments(r, types) {
    try {
        for (const type of types) {
            const posts = await fetchPosts(r, type);
            console.log(`Fetching ${type} posts...`);
            for (const post of posts) {
                await processPostComments(r, post);
            }
        }
    } catch (error) {
        console.error('Error fetching posts:', error);
    }
}

// Fetch posts based on type
async function fetchPosts(r, type) {
    switch (type) {
        case 'hot':
            return await r.getSubreddit('all').getHot();
        case 'new':
            return await r.getSubreddit('all').getNew();
        case 'rising':
            return await r.getSubreddit('all').getRising();
        case 'top':
            return await r.getSubreddit('all').getTop({ time: 'day' }); // Example: Fetch top posts of the day
        case 'best':
            return await r.getSubreddit('all').getBest();
        default:
            throw new Error(`Unsupported post type: ${type}`);
    }
}

// Process comments of a post
async function processPostComments(r, post) {
    try {
        const comments = await post.expandReplies({ limit: 100, depth: 1 }).comments;
        for (const comment of comments) {
            if (comment.body.includes('housing')) {
                console.log(`Keyword found in comment ID: ${comment.id}, replying...`);
                await replyToComment(r, comment);
            }
        }
    } catch (error) {
        console.error(`Error processing comments for post ${post.title}:`, error);
    }
}

// Reply to a comment
async function replyToComment(r, comment) {
    try {
        await comment.reply('Please visit ABCs.com');
        console.log(`Replied to comment: ${comment.id}`);
    } catch (error) {
        if (error.message.includes('RATELIMIT')) {
            const waitTime = error.message.match(/(\d+) (seconds|minutes)/);
            if (waitTime) {
                const timeToWait = waitTime[2] === 'minutes' ? parseInt(waitTime[1]) * 60 * 1000 : parseInt(waitTime[1]) * 1000;
                console.log(`Rate limited. Waiting for ${timeToWait / 1000} seconds...`);
                await delay(timeToWait);
                await replyToComment(r, comment); // Retry after waiting
            }
        } else {
            console.error(`Failed to reply to comment: ${comment.id}`, error);
        }
    }
}

// Helper function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMyComments(r) {
    try {
        const myComments = await r.getMe().getComments();
        console.log('My Comments:');
        myComments.forEach(comment => {
            console.log(`- ${comment.body}`);
        });
    } catch (error) {
        console.error('Error fetching my comments:', error);
    }
}

// Start the server
const port = 3000;
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
