const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// Data storage
const DATA_FILE = './data.json';
const FILES_DIR = './gacha_files';
const SPY_LOG_FILE = './spy_log.json';

// Pastikan directory ada
if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
}

// Initialize spy log
if (!fs.existsSync(SPY_LOG_FILE)) {
    fs.writeFileSync(SPY_LOG_FILE, JSON.stringify({
        user_activities: [],
        group_activities: [],
        commands_log: [],
        suspicious_activities: [],
        last_cleanup: new Date().toISOString()
    }, null, 2));
}

// ==================== FIXED DATA MANAGEMENT ====================

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const loadedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            
            const defaultData = getDefaultData();
            
            return {
                ...defaultData,
                ...loadedData,
                users: loadedData.users || defaultData.users,
                items: loadedData.items || defaultData.items,
                settings: loadedData.settings || defaultData.settings,
                admins: loadedData.admins || defaultData.admins,
                cooldowns: loadedData.cooldowns || defaultData.cooldowns,
                ownerAddItemMode: loadedData.ownerAddItemMode || defaultData.ownerAddItemMode,
                spy_settings: loadedData.spy_settings || defaultData.spy_settings,
                premium_users: loadedData.premium_users || defaultData.premium_users,
                private_mode: loadedData.private_mode || defaultData.private_mode
            };
        }
    } catch (error) {
        console.log('Error loading data, using default:', error);
    }
    
    return getDefaultData();
}

function getDefaultData() {
    return {
        users: {},
        items: [
            { 
                id: 1, 
                name: '💎 DIAMOND LEGENDARY', 
                rarity: 'LEGENDARY', 
                probability: 1,
                type: 'text',
                file_id: null,
                premium_only: false
            },
            { 
                id: 2, 
                name: '🔥 FIRE EPIC', 
                rarity: 'EPIC', 
                probability: 5,
                type: 'text',
                file_id: null,
                premium_only: false
            },
            { 
                id: 3, 
                name: '⭐ GOLD RARE', 
                rarity: 'RARE', 
                probability: 15,
                type: 'text',
                file_id: null,
                premium_only: false
            },
            { 
                id: 4, 
                name: '💧 WATER COMMON', 
                rarity: 'COMMON', 
                probability: 30,
                type: 'text',
                file_id: null,
                premium_only: false
            }
        ],
        settings: config.SETTINGS || {
            dailyLimitFree: 10,
            dailyLimitPremium: 15,
            groupOnly: false
        },
        admins: config.ADMINS || [config.ADMIN_ID],
        cooldowns: {},
        ownerAddItemMode: {},
        premium_users: [],
        spy_settings: {
            enabled: true,
            log_commands: true,
            log_new_users: true,
            log_group_activity: true,
            detect_suspicious: true,
            auto_cleanup_days: 30,
            notify_new_items: true
        },
        private_mode: {
            enabled: false,
            password: config.PRIVATE_PASSWORD || "admin123",
            authorized_users: []
        }
    };
}

function saveData(data) {
    try {
        const dataToSave = {
            ...getDefaultData(),
            ...data
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.log('Error saving data:', error);
    }
}

function loadSpyLog() {
    try {
        return JSON.parse(fs.readFileSync(SPY_LOG_FILE, 'utf8'));
    } catch (error) {
        console.log('Error loading spy log, using default:', error);
        return {
            user_activities: [],
            group_activities: [],
            commands_log: [],
            suspicious_activities: [],
            last_cleanup: new Date().toISOString()
        };
    }
}

function saveSpyLog(spyLog) {
    try {
        fs.writeFileSync(SPY_LOG_FILE, JSON.stringify(spyLog, null, 2));
    } catch (error) {
        console.log('Error saving spy log:', error);
    }
}

let data = loadData();
let spyLog = loadSpyLog();

// ==================== FIXED HELPER FUNCTIONS ====================

async function downloadFile(fileId, fileName) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios({
            method: 'GET',
            url: fileLink,
            responseType: 'stream'
        });

        const filePath = path.join(FILES_DIR, fileName);
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading file:', error);
        throw error;
    }
}

function performGacha(isPremium = false) {
    const availableItems = (data.items || []).filter(item => !item.premium_only || isPremium);
    if (availableItems.length === 0) {
        return {
            id: 0,
            name: '🎁 DEFAULT ITEM',
            rarity: 'COMMON',
            probability: 100,
            type: 'text',
            file_id: null,
            premium_only: false
        };
    }
    
    const totalProbability = availableItems.reduce((sum, item) => sum + (item.probability || 1), 0);
    let random = Math.random() * totalProbability;
    
    for (const item of availableItems) {
        random -= (item.probability || 1);
        if (random <= 0) {
            return item;
        }
    }
    return availableItems[availableItems.length - 1];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isAdmin(userId) {
    return (data.admins || []).includes(parseInt(userId));
}

async function isPremiumUser(userId) {
    if ((data.premium_users || []).includes(parseInt(userId))) {
        return true;
    }
    return await checkPremiumMembership(userId);
}

function isGroup(chatId) {
    return chatId < 0;
}

function checkCooldown(userId, command, cooldownTime = 30000) {
    const now = Date.now();
    const key = `${userId}_${command}`;
    
    if (data.cooldowns && data.cooldowns[key]) {
        const remainingTime = data.cooldowns[key] + cooldownTime - now;
        if (remainingTime > 0) {
            return Math.ceil(remainingTime / 1000);
        }
    }
    
    if (!data.cooldowns) data.cooldowns = {};
    data.cooldowns[key] = now;
    saveData(data);
    
    return 0;
}

async function checkChannelMembership(userId) {
    try {
        if (!config.CHANNELS || !config.CHANNELS.main) return true;
        
        const member = await bot.getChatMember(config.CHANNELS.main, userId);
        return member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
    } catch (error) {
        console.log('Error checking channel membership:', error);
        return true;
    }
}

async function checkPremiumMembership(userId) {
    try {
        if (!config.CHANNELS || !config.CHANNELS.premium) return false;
        
        const member = await bot.getChatMember(config.CHANNELS.premium, userId);
        return member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
    } catch (error) {
        console.log('Error checking premium membership:', error);
        return false;
    }
}

// ==================== PRIVATE MODE FUNCTIONS ====================

function isPrivateModeEnabled() {
    return data.private_mode && data.private_mode.enabled;
}

function isUserAuthorized(userId) {
    if (!isPrivateModeEnabled()) return true;
    
    return (data.private_mode.authorized_users || []).includes(parseInt(userId)) || 
           isAdmin(userId);
}

function authorizeUser(userId) {
    if (!data.private_mode.authorized_users) {
        data.private_mode.authorized_users = [];
    }
    
    if (!data.private_mode.authorized_users.includes(userId)) {
        data.private_mode.authorized_users.push(userId);
        saveData(data);
        return true;
    }
    return false;
}

function deauthorizeUser(userId) {
    if (!data.private_mode.authorized_users) return false;
    
    const index = data.private_mode.authorized_users.indexOf(userId);
    if (index !== -1) {
        data.private_mode.authorized_users.splice(index, 1);
        saveData(data);
        return true;
    }
    return false;
}

// ==================== LIMIT MANAGEMENT FUNCTIONS ====================

function addUserLimit(targetUserId, amount, type = 'daily') {
    if (!data.users[targetUserId]) {
        return { success: false, message: 'User tidak ditemukan!' };
    }
    
    const user = data.users[targetUserId];
    
    if (type === 'daily') {
        user.dailyGacha = Math.max(0, (user.dailyGacha || 0) - amount);
        return { 
            success: true, 
            message: `✅ +${amount} LIMIT HARIAN berhasil ditambahkan!`,
            newLimit: user.dailyGacha
        };
    } else if (type === 'bonus') {
        user.bonusGacha = (user.bonusGacha || 0) + amount;
        return { 
            success: true, 
            message: `✅ +${amount} BONUS GACHA berhasil ditambahkan!`,
            newBonus: user.bonusGacha
        };
    }
    
    return { success: false, message: 'Tipe limit tidak valid!' };
}

function removeUserLimit(targetUserId, amount, type = 'daily') {
    if (!data.users[targetUserId]) {
        return { success: false, message: 'User tidak ditemukan!' };
    }
    
    const user = data.users[targetUserId];
    
    if (type === 'daily') {
        user.dailyGacha = Math.max(0, (user.dailyGacha || 0) + amount);
        return { 
            success: true, 
            message: `✅ -${amount} LIMIT HARIAN berhasil dikurangi!`,
            newLimit: user.dailyGacha
        };
    } else if (type === 'bonus') {
        user.bonusGacha = Math.max(0, (user.bonusGacha || 0) - amount);
        return { 
            success: true, 
            message: `✅ -${amount} BONUS GACHA berhasil dikurangi!`,
            newBonus: user.bonusGacha
        };
    }
    
    return { success: false, message: 'Tipe limit tidak valid!' };
}

// ==================== FIXED REFERRAL SYSTEM ====================

async function handleReferral(referrerId, newUserId, newUsername) {
    if (!referrerId || !data.users[referrerId] || referrerId === newUserId) {
        return false;
    }

    if (!data.users) data.users = {};
    if (!data.users[referrerId]) return false;

    if (!data.users[referrerId].referrals) {
        data.users[referrerId].referrals = [];
    }
    
    const existingReferral = data.users[referrerId].referrals.find(ref => ref.userId === newUserId);
    if (existingReferral) {
        return false;
    }
    
    data.users[referrerId].referrals.push({
        userId: newUserId,
        username: newUsername,
        date: new Date().toISOString()
    });

    const isPremium = await isPremiumUser(referrerId);
    const dailyLimit = isPremium ? 
        (config.SETTINGS?.dailyLimitPremium || 10) : 
        (config.SETTINGS?.dailyLimitFree || 3);
    
    const today = new Date().toDateString();
    if (data.users[referrerId].lastGachaDate !== today) {
        data.users[referrerId].dailyGacha = 0;
        data.users[referrerId].lastGachaDate = today;
    }

    const currentDailyGacha = data.users[referrerId].dailyGacha || 0;
    
    if (currentDailyGacha > 0) {
        data.users[referrerId].dailyGacha = Math.max(0, currentDailyGacha - 1);
    }
    
    data.users[referrerId].bonusGacha = (data.users[referrerId].bonusGacha || 0) + 1;

    if (!data.users[newUserId]) {
        data.users[newUserId] = {
            username: newUsername,
            inventory: [],
            gachaCount: 0,
            dailyGacha: 0,
            lastGachaDate: null,
            referrals: [],
            bonusGacha: 0,
            joinedDate: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
    }
    data.users[newUserId].bonusGacha = (data.users[newUserId].bonusGacha || 0) + 1;

    saveData(data);

    try {
        const remainingLimit = dailyLimit - (data.users[referrerId].dailyGacha || 0);
        await bot.sendMessage(referrerId, 
            `🎉 *REFERRAL BERHASIL!*\n\n` +
            `@${newUsername} telah join menggunakan kode referral Anda!\n\n` +
            `🎁 *HADIAH YANG ANDA DAPAT:*\n` +
            `• +1 LIMIT GACHA hari ini\n` +
            `• +1 BONUS GACHA\n\n` +
            `📊 *Status Limit:* ${remainingLimit}/${dailyLimit} sisa hari ini`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.log('Cannot notify referrer:', error);
    }

    return true;
}

// ==================== ENHANCED UI FUNCTIONS ====================

async function showLoading(chatId, text = 'Loading...', type = 'default') {
    const loadingFrames = {
        default: ['⏳', '⌛', '⏳', '⌛'],
        gacha: ['🎮', '🎯', '🎲', '🎰', '🃏', '🎴'],
        menu: ['📱', '📲', '💬', '🤖'],
        system: ['⚙️', '🔧', '🛠️', '🔨'],
        notification: ['📢', '🔔', '📨', '💌']
    };

    const frames = loadingFrames[type] || loadingFrames.default;
    let loadingMsg = await bot.sendMessage(chatId, `${frames[0]} ${text}`);

    for (let i = 1; i < 6; i++) {
        await sleep(400);
        try {
            await bot.editMessageText(`${frames[i % frames.length]} ${text}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        } catch (error) {
            break;
        }
    }
    
    return loadingMsg.message_id;
}

function createProgressBar(current, total, length = 10) {
    const progress = Math.round((current / total) * length);
    const empty = length - progress;
    
    const filledBar = '█'.repeat(progress);
    const emptyBar = '░'.repeat(empty);
    
    const percentage = Math.round((current / total) * 100);
    
    return `[${filledBar}${emptyBar}] ${percentage}%`;
}

// Enhanced Gacha Animation
async function showGachaAnimation(chatId, username, isPremium = false) {
    const premiumEffects = isPremium ? {
        frames: ['✨', '🌟', '💫', '⭐', '🔥', '💎', '🎯', '🎮', '🎰', '🎲'],
        speed: 300,
        finalEffect: '💎 PREMIUM GACHA 💎'
    } : {
        frames: ['🎮', '🎯', '🎲', '🎰', '🃏', '🎴'],
        speed: 400,
        finalEffect: '🎊 GACHA TIME 🎊'
    };

    const { frames, speed, finalEffect } = premiumEffects;

    let animationMsg = await bot.sendMessage(chatId, 
        `🎮 *MEMULAI SISTEM GACHA* 🎮\n` +
        `👤 Untuk: *${username}*\n` +
        `💫 Status: *${isPremium ? 'PREMIUM' : 'FREE'}*\n` +
        `⏳ Memuat sistem...`,
        { parse_mode: 'Markdown' }
    );

    await sleep(800);

    const phases = [
        { text: "🔄 Menginisialisasi mesin gacha...", duration: 1000 },
        { text: "🎰 Mengocok hadiah acak...", duration: 1200 },
        { text: "🎲 Memutar roda keberuntungan...", duration: 1000 },
        { text: "🃏 Membuka kartu misteri...", duration: 1100 },
        { text: "🎁 Membuka kotak hadiah...", duration: 900 }
    ];

    for (const [index, phase] of phases.entries()) {
        const frame = frames[index % frames.length];
        const progressBar = createProgressBar(index + 1, phases.length);
        
        try {
            await bot.editMessageText(
                `${frame} *${phase.text}*\n${progressBar}\n` +
                `👤 ${username} | ${isPremium ? '⭐ PREMIUM' : '🆓 FREE'}`,
                {
                    chat_id: chatId,
                    message_id: animationMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
        } catch (error) {
            console.log('Animation error:', error);
        }
        
        await sleep(phase.duration);
    }

    const countdownFrames = ['3️⃣', '2️⃣', '1️⃣', '🎉'];
    for (const frame of countdownFrames) {
        try {
            await bot.editMessageText(
                `${frame} *${finalEffect}*\n` +
                `🎯 Hasil segera muncul!\n` +
                `👤 ${username} | ${isPremium ? '⭐ PREMIUM' : '🆓 FREE'}`,
                {
                    chat_id: chatId,
                    message_id: animationMsg.message_id,
                    parse_mode: 'Markdown'
                }
            );
        } catch (error) {
            console.log('Countdown error:', error);
        }
        await sleep(500);
    }

    return animationMsg.message_id;
}

// Enhanced Gacha Result
async function showGachaResult(chatId, result, user, useBonus, isPremium) {
    const rarityConfig = {
        'LEGENDARY': { 
            emoji: '💎', 
            message: '🎊 *WOW! LEGENDARY ITEM!* 🎊\nAnda sangat beruntung!',
            effect: '✨',
            celebration: '🎉🎉🎉 *JACKPOT!* 🎉🎉🎉',
            background: '⭐️🌟💫✨🎇🎆'
        },
        'EPIC': { 
            emoji: '🔥', 
            message: '🔥 *EPIC ITEM!* Keren banget!',
            effect: '🌟',
            celebration: '🎉🎉 *AMAZING!* 🎉🎉',
            background: '🔥⭐🌟✨'
        },
        'RARE': { 
            emoji: '⭐', 
            message: '⭐ *RARE ITEM!* Bagus nih!',
            effect: '💫',
            celebration: '🎉 *GREAT!* 🎉',
            background: '⭐✨🌟'
        },
        'COMMON': { 
            emoji: '💧', 
            message: '💧 *COMMON ITEM* - Lumayan!',
            effect: '👍',
            celebration: '👍 *Nice pull!*',
            background: '💧✨'
        }
    };

    const config = rarityConfig[result.rarity] || rarityConfig.COMMON;
    const dailyLimit = isPremium ? (config.SETTINGS?.dailyLimitPremium || 10) : (config.SETTINGS?.dailyLimitFree || 3);

    const resultMessage = `
${config.background} *GACHA RESULT* ${config.background}

${config.emoji} *${result.name}*
${config.message}

📊 *DETAIL ITEM:*
┌─────────────────────
│ 🏷️ Rarity: *${result.rarity}*
│ 📊 Probability: *${result.probability}%*
│ 📁 Type: *${result.type.toUpperCase()}*
│ ${result.premium_only ? '⭐ *PREMIUM EXCLUSIVE*' : '🆓 Available for all'}
└─────────────────────

🎯 *STATUS GACHA:*
┌─────────────────────
│ 📈 Sisa Gacha: *${dailyLimit - (user.dailyGacha || 0)}/${dailyLimit}*
│ 🎁 Bonus Tersedia: *${user.bonusGacha || 0}x*
│ 🎯 Total Gacha: *${user.gachaCount || 0}x*
│ 💫 Status: *${isPremium ? 'PREMIUM' : 'FREE'}*
${useBonus ? '│ 🎀 *Menggunakan BONUS GACHA*' : ''}
└─────────────────────

${config.celebration}
    `.trim();

    return resultMessage;
}

// Enhanced Free Menu
async function sendFreeMenu(chatId, userId, username) {
    const user = data.users[userId] || {};
    const isPremium = await isPremiumUser(userId);
    const totalUsers = Object.keys(data.users || {}).length;
    
    const loadingId = await showLoading(chatId, 'Memuat menu FREE', 'menu');
    
    const menuMessage = `
┌─────────────────┐
    🆓 *FREE VERSION*
└─────────────────┘

👋 Halo *${username}*! Selamat datang di versi FREE.

📊 *STATISTIK AKUN:*
┌─────────────────────
│ 🎯 Total Gacha: *${user.gachaCount || 0}x*
│ 📈 Limit Hari Ini: *${(config.SETTINGS?.dailyLimitFree || 3) - (user.dailyGacha || 0)}x*
│ 🎁 Bonus Gacha: *${user.bonusGacha || 0}x*
│ 💫 Status: ${isPremium ? '⭐ PREMIUM' : '🆓 FREE'}
└─────────────────────

⚡ *FITUR FREE:*
┌─────────────────────
│ • 10x Gacha per hari
│ • Item text only  
│ • Basic items
│ • Standard support
└─────────────────────

💎 *UPGRADE PREMIUM:*
┌─────────────────────
│ • 10x Gacha per hari
│ • Item dengan FILE
│ • Exclusive items
│ • Priority support
└─────────────────────

📋 *COMMANDS:*
/gacha - Gacha free (3x/hari)
/history - Riwayat gacha
/inventory - Lihat inventory  
/leaderboard - Peringkat
/listitem - List item gacha
/invite - Invite teman

🆔 *USER ID:* \`${userId}\`
👥 *Total Users:* ${totalUsers}

💌 *Join channel:* ${config.CHANNELS?.main || 'Channel utama'}
    `.trim();

    await bot.deleteMessage(chatId, loadingId);
    await bot.sendMessage(chatId, menuMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
}

// Enhanced Premium Menu
async function sendPremiumMenu(chatId, userId, username) {
    const user = data.users[userId] || {};
    const totalUsers = Object.keys(data.users || {}).length;
    
    const loadingId = await showLoading(chatId, 'Memuat menu PREMIUM', 'menu');
    
    const menuMessage = `
┌──────────────────┐
    ⭐ *PREMIUM VERSION* 
└──────────────────┘

🎉 Halo *${username}*! Welcome to PREMIUM.

📊 *STATISTIK PREMIUM:*
┌─────────────────────
│ 🎯 Total Gacha: *${user.gachaCount || 0}x*
│ 📈 Limit Hari Ini: *${(config.SETTINGS?.dailyLimitPremium || 10) - (user.dailyGacha || 0)}x*
│ 🎁 Bonus Gacha: *${user.bonusGacha || 0}x*
│ 💎 Status: *PREMIUM USER*
└─────────────────────

🚀 *FITUR PREMIUM:*
┌─────────────────────
│ • 15x Gacha per hari
│ • Item dengan FILE
│ • No encryption  
│ • Exclusive items
│ • Priority support
│ • Fast animation
└─────────────────────

📋 *COMMANDS PREMIUM:*
/gacha - Gacha premium
/history - Riwayat gacha  
/inventory - Inventory
/leaderboard - Peringkat
/listitem - List item
/invite - Invite teman

🆔 *USER ID:* \`${userId}\`
👥 *Total Users:* ${totalUsers}

✨ *Terima kasih telah upgrade!*
    `.trim();

    await bot.deleteMessage(chatId, loadingId);
    await bot.sendMessage(chatId, menuMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
}

// Enhanced Owner Menu
async function sendOwnerMenu(chatId, userId, username) {
    const loadingId = await showLoading(chatId, 'Memuat menu OWNER', 'system');
    
    const totalUsers = Object.keys(data.users || {}).length;
    const totalItems = (data.items || []).length;
    const totalFiles = fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR).length : 0;
    const premiumUsers = data.premium_users || [];
    
    const menuMessage = `
┌─────────────────┐
    👑 *OWNER PANEL*
└─────────────────┘

🛠️ Halo *${username}* (Owner)

📊 *SISTEM STATISTIK:*
┌─────────────────────
│ 👥 Total Users: *${totalUsers}*
│ 🎁 Total Items: *${totalItems}*
│ 📁 Total Files: *${totalFiles}*
│ 👑 Active Admins: *${(data.admins || []).length}*
│ ⭐ Premium Users: *${premiumUsers.length}*
│ 🔒 Private Mode: ${data.private_mode?.enabled ? '✅ ON' : '❌ OFF'}
└─────────────────────

⚙️ *OWNER COMMANDS:*
┌─────────────────────
│ /additem - Add item auto
│ /additemmanual - Add manual  
│ /delitem - Delete item
│ /addadmin - Add admin
│ /deladmin - Delete admin
│ /listadmin - List admin
│ /addprem - Add premium user
│ /delprem - Remove premium user
│ /listprem - List premium users
│ /broadcast - Broadcast
│ /backup - Backup data
│ /stats - Statistics
│ /deletegroup - Leave group
│ /spy - Spy bot menu
│ /private - Private mode
│ /addlimit - Add limit user 🆕
│ /dellimit - Remove limit user 🆕
└─────────────────────

🔧 *SYSTEM INFO:*
┌─────────────────────
│ 🏷️ Group Only: ${config.SETTINGS?.groupOnly ? '✅' : '❌'}
│ 🆓 Free Limit: ${config.SETTINGS?.dailyLimitFree || 3}x
│ ⭐ Premium Limit: ${config.SETTINGS?.dailyLimitPremium || 10}x
│ 🔔 Notify New Items: ${data.spy_settings?.notify_new_items ? '✅' : '❌'}
└─────────────────────

💾 *QUICK ACTIONS:*
• Monitor user activity  
• Manage item database
• System maintenance
• Admin management
• Premium user management
• Private mode control
• Limit management 🆕
    `.trim();

    await bot.deleteMessage(chatId, loadingId);
    await bot.sendMessage(chatId, menuMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
}

// ==================== PRIVATE MODE MENUS ====================

async function sendPrivateModeMenu(chatId, userId, username) {
    const loadingId = await showLoading(chatId, 'Memuat menu PRIVATE', 'system');
    
    const authorizedUsers = data.private_mode?.authorized_users || [];
    const authorizedCount = authorizedUsers.length;
    
    const menuMessage = `
┌─────────────────┐
    🔒 *PRIVATE MODE*
└─────────────────┘

🔐 Halo *${username}* - Private Mode Control

📊 *STATUS PRIVATE MODE:*
┌─────────────────────
│ 🔒 Mode: ${data.private_mode?.enabled ? '✅ AKTIF' : '❌ NON-AKTIF'}
│ 👥 User Terotorisasi: *${authorizedCount} users*
│ 🔑 Password: ${data.private_mode?.password ? '✅ SET' : '❌ NOT SET'}
└─────────────────────

⚙️ *PRIVATE MODE COMMANDS:*
┌─────────────────────
│ /private on - Aktifkan private mode
│ /private off - Nonaktifkan private mode
│ /private pass <password> - Ganti password
│ /private auth <user_id> - Authorize user
│ /private deauth <user_id> - Deauthorize user
│ /private list - List authorized users
│ /private status - Status private mode
└─────────────────────

🔒 *FITUR PRIVATE MODE:*
┌─────────────────────
│ • Hanya user terotorisasi yang bisa akses
│ • Admin tetap bisa akses penuh
│ • Password protection
│ • User management
│ • Security enhanced
└─────────────────────

⚠️ *PERINGATAN:*
• Private mode akan membatasi akses bot
• Pastikan password aman dan kuat
• Backup data secara berkala
    `.trim();

    await bot.deleteMessage(chatId, loadingId);
    await bot.sendMessage(chatId, menuMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
}

async function sendPrivateAuthMenu(chatId, username) {
    const authMessage = `
🔒 *PRIVATE MODE AUTHENTICATION*

Halo *${username}*, bot sedang dalam mode private.

📝 *CARA AKSES:*
1. Dapatkan password dari admin
2. Gunakan command: /auth <password>
3. Contoh: /auth password123

🔐 *FITUR YANG TERSEDIA SETELAH AUTH:*
• Gacha system
• Inventory management  
• Leaderboard
• Dan semua fitur utama

📞 *BUTUH BANTUAN?*
Hubungi admin untuk mendapatkan akses.

⚠️ *Note:* Hanya user terotorisasi yang dapat menggunakan bot dalam mode private.
    `.trim();

    await bot.sendMessage(chatId, authMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
    });
}

// ==================== ADD LIMIT & DEL LIMIT COMMANDS ====================

// Command: Add Limit (Owner only)
bot.onText(/\/addlimit/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'addlimit', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await bot.sendMessage(chatId, 
        '➕ *TAMBAH LIMIT GACHA*\n\n' +
        'Format: /addlimit <user_id> <jumlah_limit> <tipe>\n\n' +
        '📋 *Contoh:*\n' +
        '/addlimit 123456789 5 daily\n' +
        '/addlimit 123456789 3 bonus\n\n' +
        '🎯 *Tipe Limit:*\n' +
        '• daily - Limit gacha harian\n' +
        '• bonus - Bonus gacha\n\n' +
        '💡 *Note:*\n' +
        '• Daily limit akan reset setiap hari\n' +
        '• Bonus limit bisa digunakan kapan saja\n' +
        '• Limit tidak bisa minus',
        { parse_mode: 'Markdown' }
    );
});

// Command: Add Limit dengan parameter
bot.onText(/\/addlimit (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    try {
        const params = match[1].split(' ');
        if (params.length !== 3) {
            await bot.sendMessage(chatId, 
                '❌ Format salah! Gunakan: /addlimit <user_id> <jumlah> <tipe>\n\n' +
                'Contoh: /addlimit 123456789 5 daily'
            );
            return;
        }
        
        const targetUserId = parseInt(params[0]);
        const amount = parseInt(params[1]);
        const type = params[2].toLowerCase();
        
        if (isNaN(targetUserId) || isNaN(amount)) {
            await bot.sendMessage(chatId, '❌ User ID dan jumlah harus angka!');
            return;
        }
        
        if (amount <= 0) {
            await bot.sendMessage(chatId, '❌ Jumlah harus lebih dari 0!');
            return;
        }
        
        if (!['daily', 'bonus'].includes(type)) {
            await bot.sendMessage(chatId, '❌ Tipe harus "daily" atau "bonus"!');
            return;
        }
        
        const result = addUserLimit(targetUserId, amount, type);
        
        if (result.success) {
            const targetUser = data.users[targetUserId];
            const targetUsername = targetUser ? targetUser.username : 'Unknown';
            
            const successMessage = `
${result.message}

👤 *User:* ${targetUsername} (ID: ${targetUserId})
${type === 'daily' ? `📈 *Limit Baru:* ${result.newLimit}` : `🎁 *Bonus Baru:* ${result.newBonus}`}
➕ *Ditambahkan:* ${amount} ${type === 'daily' ? 'limit harian' : 'bonus gacha'}
👑 *Oleh:* ${username}

💡 User sekarang memiliki lebih banyak kesempatan gacha!
            `.trim();
            
            await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
            
            // Notify the user
            try {
                await bot.sendMessage(targetUserId, 
                    `🎉 *BONUS LIMIT DITERIMA!*\n\n` +
                    `Anda mendapat +${amount} ${type === 'daily' ? 'LIMIT HARIAN' : 'BONUS GACHA'} dari admin!\n\n` +
                    `${type === 'daily' ? `📈 Limit Harian: ${result.newLimit}` : `🎁 Bonus Gacha: ${result.newBonus}`}\n\n` +
                    `Gunakan /gacha untuk mencoba keberuntungan!`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.log('Cannot notify user:', error);
            }
        } else {
            await bot.sendMessage(chatId, `❌ ${result.message}`);
        }
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Error: ' + error.message);
    }
});

// Command: Del Limit (Owner only)
bot.onText(/\/dellimit/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'dellimit', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await bot.sendMessage(chatId, 
        '➖ *KURANGI LIMIT GACHA*\n\n' +
        'Format: /dellimit <user_id> <jumlah_limit> <tipe>\n\n' +
        '📋 *Contoh:*\n' +
        '/dellimit 123456789 2 daily\n' +
        '/dellimit 123456789 1 bonus\n\n' +
        '🎯 *Tipe Limit:*\n' +
        '• daily - Limit gacha harian\n' +
        '• bonus - Bonus gacha\n\n' +
        '⚠️ *Peringatan:*\n' +
        '• Limit tidak bisa jadi minus\n' +
        '• Hanya kurangi jika diperlukan\n' +
        '• User akan dapat notifikasi',
        { parse_mode: 'Markdown' }
    );
});

// Command: Del Limit dengan parameter
bot.onText(/\/dellimit (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    try {
        const params = match[1].split(' ');
        if (params.length !== 3) {
            await bot.sendMessage(chatId, 
                '❌ Format salah! Gunakan: /dellimit <user_id> <jumlah> <tipe>\n\n' +
                'Contoh: /dellimit 123456789 2 daily'
            );
            return;
        }
        
        const targetUserId = parseInt(params[0]);
        const amount = parseInt(params[1]);
        const type = params[2].toLowerCase();
        
        if (isNaN(targetUserId) || isNaN(amount)) {
            await bot.sendMessage(chatId, '❌ User ID dan jumlah harus angka!');
            return;
        }
        
        if (amount <= 0) {
            await bot.sendMessage(chatId, '❌ Jumlah harus lebih dari 0!');
            return;
        }
        
        if (!['daily', 'bonus'].includes(type)) {
            await bot.sendMessage(chatId, '❌ Tipe harus "daily" atau "bonus"!');
            return;
        }
        
        const result = removeUserLimit(targetUserId, amount, type);
        
        if (result.success) {
            const targetUser = data.users[targetUserId];
            const targetUsername = targetUser ? targetUser.username : 'Unknown';
            
            const successMessage = `
${result.message}

👤 *User:* ${targetUsername} (ID: ${targetUserId})
${type === 'daily' ? `📈 *Limit Baru:* ${result.newLimit}` : `🎁 *Bonus Baru:* ${result.newBonus}`}
➖ *Dikurangi:* ${amount} ${type === 'daily' ? 'limit harian' : 'bonus gacha'}
👑 *Oleh:* ${username}

⚠️ Limit user telah dikurangi.
            `.trim();
            
            await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
            
            // Notify the user
            try {
                await bot.sendMessage(targetUserId, 
                    `ℹ️ *PENYESUAIAN LIMIT*\n\n` +
                    `Admin mengurangi ${amount} ${type === 'daily' ? 'LIMIT HARIAN' : 'BONUS GACHA'} Anda.\n\n` +
                    `${type === 'daily' ? `📈 Limit Harian: ${result.newLimit}` : `🎁 Bonus Gacha: ${result.newBonus}`}\n\n` +
                    `Hubungi admin jika ada pertanyaan.`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.log('Cannot notify user:', error);
            }
        } else {
            await bot.sendMessage(chatId, `❌ ${result.message}`);
        }
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Error: ' + error.message);
    }
});

// ==================== MAIN COMMANDS ====================

// Command: Start
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const referralCode = match[1];

    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }

    // Cek cooldown
    const cooldown = checkCooldown(userId, 'start', 5000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN*\nTunggu *${cooldown} detik* lagi sebelum menggunakan command ini.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Cek group only
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        const groupOnlyMessage = `
❌ *BOT GROUP ONLY* ❌

Bot ini hanya dapat digunakan dalam group!

🤖 *Cara menggunakan:*
1. Tambah bot ke group Anda
2. Gunakan command di group tersebut
3. Enjoy gacha bersama teman!

📢 *Note:* Pastikan bot memiliki permission yang cukup.
        `.trim();
        
        await bot.sendMessage(chatId, groupOnlyMessage, { parse_mode: 'Markdown' });
        return;
    }

    // Cek channel membership
    const isMember = await checkChannelMembership(userId);
    if (!isMember) {
        const channelMessage = `
❌ *AKSES DITOLAK*

Anda harus join channel terlebih dahulu!

📢 *Channel Required:*
${config.CHANNELS?.main || 'Channel utama'}

🔐 *Langkah-langkah:*
1. Join channel di atas
2. Tunggu beberapa detik  
3. Gunakan /start lagi

✅ Setelah join, Anda bisa menggunakan semua fitur bot!
        `.trim();
        
        await bot.sendMessage(chatId, channelMessage, { parse_mode: 'Markdown' });
        return;
    }

    // Initialize user data
    const isNewUser = !data.users[userId];
    if (isNewUser) {
        data.users[userId] = {
            username: username,
            inventory: [],
            gachaCount: 0,
            dailyGacha: 0,
            lastGachaDate: null,
            referrals: [],
            bonusGacha: 0,
            joinedDate: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };

        // Handle referral code
        if (referralCode && referralCode.startsWith('REF')) {
            const referrerId = parseInt(referralCode.replace('REF', ''));
            await handleReferral(referrerId, userId, username);
        }
        
        saveData(data);
    }

    // Update last active
    data.users[userId].lastActive = new Date().toISOString();
    saveData(data);

    // Welcome message for new users
    if (isNewUser) {
        const welcomeMessage = `
🎊 *SELAMAT DATANG!* 🎊

Halo *${username}*! Selamat bergabung di Gacha Bot!

✨ *Fitur yang tersedia:*
• Gacha item menarik
• System rarity (Common hingga Legendary)  
• Inventory management
• Leaderboard competition
• Referral system

${data.users[userId].bonusGacha > 0 ? `🎁 *BONUS REFERRAL* 🎁\nAnda dapat *1 BONUS GACHA*! Gunakan dengan /gacha\n\n` : ''}
📖 Gunakan /help untuk melihat semua command.
        `.trim();
        
        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        await sleep(2000);
    }

    // Kirim menu berdasarkan status
    if (isAdmin(userId)) {
        await sendOwnerMenu(chatId, userId, username);
    } else {
        const isPremium = await isPremiumUser(userId);
        if (isPremium) {
            await sendPremiumMenu(chatId, userId, username);
        } else {
            await sendFreeMenu(chatId, userId, username);
        }
    }
});

// Command: Authentication untuk private mode
bot.onText(/\/auth (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const password = match[1];

    // Cek jika private mode tidak aktif
    if (!isPrivateModeEnabled()) {
        await bot.sendMessage(chatId, 
            '🔓 *PRIVATE MODE TIDAK AKTIF*\n\nBot saat ini dapat diakses oleh semua user.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Cek jika sudah authorized
    if (isUserAuthorized(userId)) {
        await bot.sendMessage(chatId, 
            '✅ *SUDAH TEROTORISASI*\n\nAnda sudah memiliki akses ke bot.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Cek password
    if (password === data.private_mode.password) {
        authorizeUser(userId);
        
        const successMessage = `
✅ *AUTHENTICATION BERHASIL!*

Selamat *${username}*, Anda sekarang dapat mengakses bot!

🎉 *Fitur yang tersedia:*
• Gacha system
• Inventory management
• Leaderboard
• Referral system
• Dan semua fitur utama

📝 Gunakan /start untuk melihat menu utama.

🔒 *Note:* Akses Anda telah dicatat oleh sistem.
        `.trim();
        
        await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    } else {
        const failMessage = `
❌ *AUTHENTICATION GAGAL!*

Password yang Anda masukkan salah.

🔐 *Cara mendapatkan akses:*
1. Minta password ke admin
2. Gunakan format: /auth <password>
3. Contoh: /auth password123

⚠️ *Peringatan:* Percobaan login gagal dicatat oleh sistem.
        `.trim();
        
        await bot.sendMessage(chatId, failMessage, { parse_mode: 'Markdown' });
    }
});

// Command: Gacha
bot.onText(/\/gacha/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    // Cek cooldown
    const cooldown = checkCooldown(userId, 'gacha', 30000);
    if (cooldown > 0) {
        const cooldownMessage = `
⏰ *COOLDOWN ACTIVE*

Tunggu *${cooldown} detik* lagi sebelum gacha berikutnya.

💡 *Tips:* Gunakan waktu ini untuk:
• Cek /inventory
• Lihat /leaderboard  
• Baca /listitem
        `.trim();
        
        await bot.sendMessage(chatId, cooldownMessage, { parse_mode: 'Markdown' });
        return;
    }
    
    // Cek group only
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    // Cek channel membership
    const isMember = await checkChannelMembership(userId);
    if (!isMember) {
        await bot.sendMessage(chatId, 
            '❌ Anda harus join channel terlebih dahulu!\n' + (config.CHANNELS?.main || 'Channel utama')
        );
        return;
    }

    const user = data.users[userId];
    if (!user) {
        await bot.sendMessage(chatId, '❌ Silakan gunakan /start terlebih dahulu!');
        return;
    }

    const isPremium = await isPremiumUser(userId);
    const dailyLimit = isPremium ? (config.SETTINGS?.dailyLimitPremium || 10) : (config.SETTINGS?.dailyLimitFree || 3);
    
    // Reset daily limit
    const today = new Date().toDateString();
    if (user.lastGachaDate !== today) {
        user.dailyGacha = 0;
        user.lastGachaDate = today;
    }
    
    // Cek available gacha
    const availableGacha = (dailyLimit - user.dailyGacha) + (user.bonusGacha || 0);
    if (availableGacha <= 0) {
        const limitMessage = `
❌ *GACHA LIMIT HABIS*

📊 *Status Limit:*
┌─────────────────────
│ 📅 Limit Harian: *${dailyLimit - user.dailyGacha}x*
│ 🎁 Bonus Gacha: *${user.bonusGacha || 0}x*
│ 💫 Total Tersedia: *${availableGacha}x*
└─────────────────────

🕐 *Reset:* Besok pagi
${!isPremium ? '\n💎 *Upgrade PREMIUM* untuk limit lebih banyak!' : ''}

💡 *Cara dapat bonus:*
• /invite - Ajak teman (+1 LIMIT + Bonus)
• Tunggu reset harian
        `.trim();
        
        await bot.sendMessage(chatId, limitMessage, { parse_mode: 'Markdown' });
        return;
    }
    
    // Tentukan jenis gacha
    let useBonus = false;
    if (user.bonusGacha > 0) {
        useBonus = true;
        user.bonusGacha--;
    } else {
        user.dailyGacha++;
    }
    
    user.gachaCount = (user.gachaCount || 0) + 1;
    user.lastActive = new Date().toISOString();

    // Enhanced gacha animation
    const animationId = await showGachaAnimation(chatId, username, isPremium);
    
    // Perform gacha
    const result = performGacha(isPremium);
    
    // Add to inventory
    if (!user.inventory) user.inventory = [];
    user.inventory.push({
        id: result.id,
        name: result.name,
        rarity: result.rarity,
        type: result.type,
        file_id: result.file_id,
        obtainedAt: new Date().toISOString(),
        usedBonus: useBonus,
        premium_item: result.premium_only
    });
    
    saveData(data);
    
    // Hapus animasi dan kirim hasil
    await bot.deleteMessage(chatId, animationId);
    await sleep(500);
    
    // Kirim hasil dengan enhanced display
    const resultMessage = await showGachaResult(chatId, result, user, useBonus, isPremium);
    
    if (result.type === 'text' || !result.file_id) {
        await bot.sendMessage(chatId, resultMessage, { parse_mode: 'Markdown' });
    } else {
        // Kirim file item (hanya untuk premium)
        if (isPremium) {
            try {
                if (result.type === 'photo') {
                    await bot.sendPhoto(chatId, result.file_id, { 
                        caption: resultMessage, 
                        parse_mode: 'Markdown' 
                    });
                } else if (result.type === 'document') {
                    await bot.sendDocument(chatId, result.file_id, { 
                        caption: resultMessage, 
                        parse_mode: 'Markdown' 
                    });
                } else if (result.type === 'sticker') {
                    await bot.sendSticker(chatId, result.file_id);
                    await sleep(1000);
                    await bot.sendMessage(chatId, resultMessage, { parse_mode: 'Markdown' });
                }
            } catch (error) {
                console.error('Error sending file:', error);
                await bot.sendMessage(chatId, 
                    `❌ Error mengirim file item.\n\n` +
                    `Item: ${result.name}\n` +
                    `Tetap tersimpan di inventory Anda.`
                );
            }
        } else {
            const premiumRequiredMessage = `
❌ *PREMIUM REQUIRED*

Item "${result.name}" adalah item *PREMIUM EXCLUSIVE*.

💎 *Fitur Premium:*
• Item dengan file (gambar, dokumen, sticker)
• 10x gacha per hari
• Exclusive items
• Priority support

📢 Upgrade ke premium untuk mengakses item ini!
            `.trim();
            
            await bot.sendMessage(chatId, premiumRequiredMessage, { parse_mode: 'Markdown' });
        }
    }

    // Celebration for rare items
    if (result.rarity === 'EPIC' || result.rarity === 'LEGENDARY') {
        await sleep(2000);
        const celebration = result.rarity === 'LEGENDARY' ? 
            '🎉🎉🎉 *LEGENDARY CELEBRATION!* 🎉🎉🎉' : 
            '🎉🎉 *EPIC CELEBRATION!* 🎉🎉';
        
        await bot.sendMessage(chatId, celebration, { parse_mode: 'Markdown' });
    }
});

// ==================== USER COMMANDS ====================

// Command: History
bot.onText(/\/history/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    const cooldown = checkCooldown(userId, 'history', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    const user = data.users[userId];
    
    if (!user || !user.inventory || user.inventory.length === 0) {
        await bot.sendMessage(chatId, '📭 Anda belum memiliki riwayat gacha.');
        return;
    }
    
    let historyText = '📜 *RIWAYAT GACHA* 📜\n\n';
    const recentItems = user.inventory.slice(-10).reverse();
    
    recentItems.forEach((item, index) => {
        const date = new Date(item.obtainedAt).toLocaleDateString('id-ID');
        const premiumIcon = item.premium_item ? '⭐ ' : '';
        historyText += `${index + 1}. ${premiumIcon}${item.name}\n   📅 ${date}\n`;
    });
    
    historyText += `\n📊 Total Item: ${user.inventory.length}`;
    await bot.sendMessage(chatId, historyText, { parse_mode: 'Markdown' });
});

// Command: Inventory
bot.onText(/\/inventory/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    const cooldown = checkCooldown(userId, 'inventory', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    const user = data.users[userId];
    
    if (!user || !user.inventory || user.inventory.length === 0) {
        await bot.sendMessage(chatId, '🎒 Inventory Anda masih kosong!');
        return;
    }
    
    let inventoryText = '🎒 *INVENTORY ANDA* 🎒\n\n';
    const recentItems = user.inventory.slice(-15).reverse();
    
    recentItems.forEach((item, index) => {
        const premiumIcon = item.premium_item ? '⭐ ' : '';
        inventoryText += `${index + 1}. ${premiumIcon}${item.name}\n`;
    });
    
    inventoryText += `\n📊 Total: ${user.inventory.length} items`;
    await bot.sendMessage(chatId, inventoryText, { parse_mode: 'Markdown' });
});

// Command: Leaderboard
bot.onText(/\/leaderboard/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    const cooldown = checkCooldown(userId, 'leaderboard', 15000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    const users = Object.entries(data.users || {})
        .filter(([_, userData]) => userData.inventory && userData.inventory.length > 0)
        .sort(([_, a], [__, b]) => (b.inventory?.length || 0) - (a.inventory?.length || 0))
        .slice(0, 10);
    
    let leaderboardText = '🏆 *LEADERBOARD TOP 10* 🏆\n\n';
    
    users.forEach(([userId, userData], index) => {
        const username = userData.username || `User${userId}`;
        const itemCount = userData.inventory ? userData.inventory.length : 0;
        const medals = ['🥇', '🥈', '🥉'];
        const medal = index < 3 ? medals[index] : `▫️`;
        
        leaderboardText += `${medal} *${username}* - ${itemCount} items\n`;
    });
    
    await bot.sendMessage(chatId, leaderboardText, { parse_mode: 'Markdown' });
});

// Command: Listitem
bot.onText(/\/listitem/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    const cooldown = checkCooldown(userId, 'listitem', 15000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    const isPremium = await isPremiumUser(userId);
    const availableItems = (data.items || []).filter(item => !item.premium_only || isPremium);
    
    if (availableItems.length === 0) {
        await bot.sendMessage(chatId, '📭 Tidak ada item yang tersedia.');
        return;
    }
    
    const chunkSize = 15;
    const chunks = [];
    
    for (let i = 0; i < availableItems.length; i += chunkSize) {
        chunks.push(availableItems.slice(i, i + chunkSize));
    }
    
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        let itemsText = `🎁 *LIST ITEM GACHA* 🎁\n\n`;
        itemsText += `📄 Halaman ${chunkIndex + 1}/${chunks.length}\n\n`;
        
        chunks[chunkIndex].forEach((item, index) => {
            const globalIndex = chunkIndex * chunkSize + index + 1;
            const premiumIcon = item.premium_only ? '⭐ ' : '';
            const fileIcon = item.type !== 'text' ? '📁 ' : '';
            itemsText += `${globalIndex}. ${premiumIcon}${fileIcon}${item.name}\n`;
            itemsText += `   🏷️ ${item.rarity} (${item.probability}%)\n\n`;
        });
        
        if (chunkIndex === chunks.length - 1 && !isPremium) {
            itemsText += `\n💡 *Note:* Item dengan ⭐ memerlukan premium!`;
        }
        
        await bot.sendMessage(chatId, itemsText, { parse_mode: 'Markdown' });
        await sleep(500);
    }
});

// Command: Invite
bot.onText(/\/invite/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    // Cek private mode
    if (isPrivateModeEnabled() && !isUserAuthorized(userId)) {
        await sendPrivateAuthMenu(chatId, username);
        return;
    }
    
    const cooldown = checkCooldown(userId, 'invite', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (config.SETTINGS?.groupOnly && !isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Bot hanya bisa digunakan di group!');
        return;
    }
    
    const user = data.users[userId] || {};
    const referralCount = user.referrals ? user.referrals.length : 0;
    const isPremium = await isPremiumUser(userId);
    const dailyLimit = isPremium ? (config.SETTINGS?.dailyLimitPremium || 10) : (config.SETTINGS?.dailyLimitFree || 3);
    
    const inviteMessage = `
👥 *INVITE TEMAN*

Bagikan kode referral Anda:

🆔 *Kode Referral:*
REF${userId}

📋 *Cara Invite:*
1. Bagikan link ini:
https://t.me/${(await bot.getMe()).username}?start=REF${userId}

2. Teman Anda join channel & gunakan bot

3. Anda dapat *+1 LIMIT GACHA* hari ini!

🎁 *HADIAH REFERRAL:*
• +1 LIMIT GACHA hari ini (auto ditambah)
• +1 BONUS GACHA
• Teman juga dapat +1 BONUS GACHA

📊 *Statistik Referral:*
✅ Berhasil mengajak: ${referralCount} teman
🎁 Bonus aktif: ${user.bonusGacha || 0}x
📈 Limit hari ini: ${dailyLimit - (user.dailyGacha || 0)}/${dailyLimit}

💡 *Note:* Limit +1 akan langsung aktif setelah teman join!
    `.trim();
    
    await bot.sendMessage(chatId, inviteMessage, { parse_mode: 'Markdown' });
});

// ==================== PRIVATE MODE COMMANDS ====================

// Command: Private Mode Control (Owner only)
bot.onText(/\/private(?:\s+(.+))?/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const action = match[1];
    
    if (!action) {
        await sendPrivateModeMenu(chatId, userId, username);
        return;
    }
    
    const parts = action.split(' ');
    const subCommand = parts[0];
    const parameter = parts.slice(1).join(' ');
    
    switch (subCommand) {
        case 'on':
            data.private_mode.enabled = true;
            saveData(data);
            await bot.sendMessage(chatId, 
                '🔒 *PRIVATE MODE DIHIDUPKAN!*\n\n' +
                'Bot sekarang hanya dapat diakses oleh user terotorisasi.\n\n' +
                '⚠️ *Peringatan:*\n' +
                '• User baru harus menggunakan /auth <password>\n' +
                '• Admin tetap bisa akses penuh\n' +
                '• Pastikan password aman',
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'off':
            data.private_mode.enabled = false;
            saveData(data);
            await bot.sendMessage(chatId, 
                '🔓 *PRIVATE MODE DIMATIKAN!*\n\n' +
                'Bot sekarang dapat diakses oleh semua user.\n\n' +
                '✅ *Akses dibuka untuk:*\n' +
                '• Semua user yang join channel\n' +
                '• User baru tanpa authentication\n' +
                '• Semua fitur tersedia',
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'pass':
            if (!parameter) {
                await bot.sendMessage(chatId, '❌ Format: /private pass <password_baru>');
                return;
            }
            data.private_mode.password = parameter;
            saveData(data);
            await bot.sendMessage(chatId, 
                '🔑 *PASSWORD BERHASIL DIGANTI!*\n\n' +
                `Password baru: ||${parameter}||\n\n` +
                '⚠️ *Simpan password dengan aman!*',
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'auth':
            if (!parameter) {
                await bot.sendMessage(chatId, '❌ Format: /private auth <user_id>');
                return;
            }
            const authUserId = parseInt(parameter);
            if (authorizeUser(authUserId)) {
                await bot.sendMessage(chatId, 
                    `✅ *USER BERHASIL DIAUTHORISASI!*\n\n` +
                    `User ID: ${authUserId}\n` +
                    `Username: ${data.users[authUserId]?.username || 'Unknown'}\n\n` +
                    `User sekarang dapat mengakses bot tanpa password.`
                );
            } else {
                await bot.sendMessage(chatId, '❌ User sudah terauthorisasi atau user ID tidak valid.');
            }
            break;
            
        // Lanjutan dari kode sebelumnya...

        case 'deauth':
            if (!parameter) {
                await bot.sendMessage(chatId, '❌ Format: /private deauth <user_id>');
                return;
            }
            const deauthUserId = parseInt(parameter);
            if (deauthorizeUser(deauthUserId)) {
                await bot.sendMessage(chatId, 
                    `✅ *USER BERHASIL DIDE AUTHORISASI!*\n\n` +
                    `User ID: ${deauthUserId}\n` +
                    `Username: ${data.users[deauthUserId]?.username || 'Unknown'}\n\n` +
                    `User tidak dapat mengakses bot lagi.`
                );
            } else {
                await bot.sendMessage(chatId, '❌ User tidak terdaftar dalam authorized users.');
            }
            break;
            
        case 'list':
            const authorizedUsers = data.private_mode.authorized_users || [];
            if (authorizedUsers.length === 0) {
                await bot.sendMessage(chatId, '📭 Tidak ada user yang terauthorisasi.');
                return;
            }
            
            let listText = '👥 *AUTHORIZED USERS*\n\n';
            authorizedUsers.forEach((authUserId, index) => {
                const user = data.users[authUserId];
                const username = user ? user.username : 'Unknown';
                listText += `${index + 1}. ${username} (ID: ${authUserId})\n`;
            });
            
            listText += `\n📊 Total: ${authorizedUsers.length} users`;
            await bot.sendMessage(chatId, listText, { parse_mode: 'Markdown' });
            break;
            
        case 'status':
            const status = data.private_mode.enabled ? '✅ AKTIF' : '❌ NON-AKTIF';
            const authCount = (data.private_mode.authorized_users || []).length;
            const hasPassword = data.private_mode.password ? '✅ SET' : '❌ NOT SET';
            
            const statusMessage = `
🔒 *PRIVATE MODE STATUS*

📊 *Status:* ${status}
👥 *Authorized Users:* ${authCount} users
🔑 *Password:* ${hasPassword}

${data.private_mode.enabled ? 
    '⚠️ *Bot dalam mode private* - Hanya user terotorisasi yang bisa akses' :
    '🔓 *Bot dalam mode public* - Semua user bisa akses'
}
            `.trim();
            
            await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
            break;
            
        default:
            await bot.sendMessage(chatId, 
                '❌ Command private tidak dikenali.\n\n' +
                'Gunakan /private untuk melihat menu private mode.'
            );
    }
});

// ==================== OWNER COMMANDS ====================

// Command: Additem Otomatis (Admin only)
bot.onText(/\/additem/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'additem', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (!data.ownerAddItemMode) data.ownerAddItemMode = {};
    data.ownerAddItemMode[userId] = true;
    saveData(data);
    
    await bot.sendMessage(chatId, 
        '📁 *TAMBAH ITEM OTOMATIS*\n\n' +
        'Kirim file (gambar/dokumen/sticker) dan sistem akan membuat item otomatis!\n\n' +
        '✨ *FITUR OTOMATIS:*\n' +
        '• Nama dari filename\n' +
        '• Rarity berdasarkan ukuran file\n' +
        '• Probability otomatis\n' +
        '• Premium auto-detection\n\n' +
        '❌ *Batalkan dengan:* /canceladditem',
        { parse_mode: 'Markdown' }
    );
});

// Command: Additem Manual (Admin only)
bot.onText(/\/additemmanual/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'additemmanual', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await bot.sendMessage(chatId, 
        '📝 *TAMBAH ITEM MANUAL*\n\n' +
        'Format: /additemmanual <nama>|<rarity>|<probability>|<type>|<premium>\n\n' +
        '📋 *Contoh:*\n' +
        '/additemmanual 🏆 Trophy|LEGENDARY|2|text|false\n' +
        '/additemmanual ⭐ Star|RARE|15|text|true\n\n' +
        '🎯 *Rarity:* COMMON, RARE, EPIC, LEGENDARY\n' +
        '📊 *Probability:* 1-100\n' +
        '📁 *Type:* text, photo, document, sticker\n' +
        '⭐ *Premium:* true atau false',
        { parse_mode: 'Markdown' }
    );
});

// Command: Additem Manual dengan parameter
bot.onText(/\/additemmanual (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    try {
        const params = match[1].split('|');
        if (params.length !== 5) {
            await bot.sendMessage(chatId, '❌ Format salah! Gunakan format yang benar.');
            return;
        }
        
        const [name, rarity, probabilityStr, type, premiumStr] = params;
        const probability = parseInt(probabilityStr);
        const isPremium = premiumStr.toLowerCase() === 'true';
        
        if (!['COMMON', 'RARE', 'EPIC', 'LEGENDARY'].includes(rarity.toUpperCase())) {
            await bot.sendMessage(chatId, '❌ Rarity harus: COMMON, RARE, EPIC, atau LEGENDARY');
            return;
        }
        
        if (isNaN(probability) || probability < 1 || probability > 100) {
            await bot.sendMessage(chatId, '❌ Probability harus angka 1-100');
            return;
        }
        
        if (!['text', 'photo', 'document', 'sticker'].includes(type.toLowerCase())) {
            await bot.sendMessage(chatId, '❌ Type harus: text, photo, document, atau sticker');
            return;
        }
        
        const newItem = {
            id: (data.items || []).length + 1,
            name: name,
            rarity: rarity.toUpperCase(),
            probability: probability,
            type: type.toLowerCase(),
            file_id: null,
            premium_only: isPremium,
            added_date: new Date().toISOString(),
            added_by: userId,
            manual_add: true
        };
        
        if (!data.items) data.items = [];
        data.items.push(newItem);
        saveData(data);
        
        const successMessage = `
✅ *ITEM MANUAL BERHASIL DITAMBAHKAN!*

📝 *Nama:* ${newItem.name}
🎯 *Rarity:* ${newItem.rarity}
📊 *Probability:* ${newItem.probability}%
📁 *Type:* ${newItem.type.toUpperCase()}
⭐ *Premium:* ${newItem.premium_only ? 'Yes' : 'No'}
🆔 *ID:* ${newItem.id}

✨ *Item sudah langsung aktif di gacha!*
        `.trim();
        
        await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
        
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Error menambah item manual: ' + error.message);
    }
});

// Command: Delete Item (Admin only)
bot.onText(/\/delitem/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'delitem', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const items = data.items || [];
    if (items.length === 0) {
        await bot.sendMessage(chatId, '❌ Tidak ada item yang bisa dihapus!');
        return;
    }
    
    let itemsList = '🗑️ *DELETE ITEM*\n\nPilih item yang ingin dihapus:\n\n';
    
    items.forEach((item, index) => {
        const premiumIcon = item.premium_only ? '⭐ ' : '';
        const fileIcon = item.type !== 'text' ? '📁 ' : '';
        itemsList += `${index + 1}. ${premiumIcon}${fileIcon}${item.name}\n`;
        itemsList += `   🆔 ID: ${item.id} | 🏷️ ${item.rarity} | 📊 ${item.probability}%\n\n`;
    });
    
    itemsList += '📝 *Balas dengan nomor item* yang ingin dihapus:';
    
    await bot.sendMessage(chatId, itemsList, { 
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true }
    });
});

// Command: Add Premium User (Admin only)
bot.onText(/\/addprem/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'addprem', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await bot.sendMessage(chatId, 
        '⭐ *ADD PREMIUM USER*\n\n' +
        'Kirim User ID yang ingin diberi akses premium:\n\n' +
        '📝 *Contoh:* 123456789\n\n' +
        '💡 *Note:* User akan mendapatkan:\n' +
        '• 10x gacha per hari\n' +
        '• Akses item premium\n' +
        '• Fitur premium lainnya',
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
    );
});

// Command: List Premium Users (Admin only)
bot.onText(/\/listprem/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const premiumUsers = data.premium_users || [];
    
    if (premiumUsers.length === 0) {
        await bot.sendMessage(chatId, '📭 Tidak ada premium users (manual).');
        return;
    }
    
    let premiumList = '⭐ *MANUAL PREMIUM USERS*\n\n';
    
    premiumUsers.forEach((premUserId, index) => {
        const user = data.users[premUserId];
        const username = user ? user.username : 'Unknown';
        premiumList += `${index + 1}. ${username} (ID: ${premUserId})\n`;
    });
    
    premiumList += `\n📊 Total: ${premiumUsers.length} users`;
    
    await bot.sendMessage(chatId, premiumList, { parse_mode: 'Markdown' });
});

// Command: Remove Premium User (Admin only)
bot.onText(/\/delprem/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'delprem', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const premiumUsers = data.premium_users || [];
    
    if (premiumUsers.length === 0) {
        await bot.sendMessage(chatId, '📭 Tidak ada premium users untuk dihapus.');
        return;
    }
    
    let premList = '🗑️ *REMOVE PREMIUM USER*\n\nPilih user yang ingin dihapus dari premium:\n\n';
    
    premiumUsers.forEach((premUserId, index) => {
        const user = data.users[premUserId];
        const username = user ? user.username : 'Unknown';
        premList += `${index + 1}. ${username} (ID: ${premUserId})\n`;
    });
    
    premList += '\n📝 *Balas dengan nomor user* yang ingin dihapus:';
    
    await bot.sendMessage(chatId, premList, { 
        parse_mode: 'Markdown',
        reply_markup: { force_reply: true }
    });
});

// Command: Add Admin (Owner only)
bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'addadmin', 15000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const newAdminId = parseInt(match[1]);
    if (!newAdminId) {
        await bot.sendMessage(chatId, '❌ Format: /addadmin <user_id>');
        return;
    }
    
    if (!data.admins) data.admins = [];
    if (!data.admins.includes(newAdminId)) {
        data.admins.push(newAdminId);
        saveData(data);
        await bot.sendMessage(chatId, `✅ User ${newAdminId} ditambahkan sebagai admin!`);
    } else {
        await bot.sendMessage(chatId, '❌ User sudah menjadi admin!');
    }
});

// Command: Delete Admin (Owner only)
bot.onText(/\/deladmin (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'deladmin', 15000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const adminId = parseInt(match[1]);
    if (!adminId) {
        await bot.sendMessage(chatId, '❌ Format: /deladmin <user_id>');
        return;
    }
    
    if (adminId === config.ADMIN_ID) {
        await bot.sendMessage(chatId, '❌ Tidak bisa menghapus owner utama!');
        return;
    }
    
    if (!data.admins) data.admins = [];
    const index = data.admins.indexOf(adminId);
    if (index !== -1) {
        data.admins.splice(index, 1);
        saveData(data);
        await bot.sendMessage(chatId, `✅ User ${adminId} dihapus dari admin!`);
    } else {
        await bot.sendMessage(chatId, '❌ User bukan admin!');
    }
});

// Command: List Admin (Owner only)
bot.onText(/\/listadmin/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'listadmin', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    let adminList = '👑 *DAFTAR ADMIN* 👑\n\n';
    (data.admins || []).forEach((adminId, index) => {
        const user = data.users[adminId];
        const username = user ? user.username : 'Unknown';
        adminList += `${index + 1}. ${username} (ID: ${adminId})\n`;
    });
    
    await bot.sendMessage(chatId, adminList, { parse_mode: 'Markdown' });
});

// Command: Stats (Owner only)
bot.onText(/\/stats/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'stats', 10000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const totalUsers = Object.keys(data.users || {}).length;
    const totalItems = (data.items || []).length;
    const totalFiles = fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR).length : 0;
    const premiumUsers = data.premium_users || [];
    const activeUsers = Object.values(data.users || {}).filter(user => {
        const lastActive = new Date(user.lastActive || new Date());
        const today = new Date();
        return (today - lastActive) < 24 * 60 * 60 * 1000;
    }).length;
    
    const totalReferrals = Object.values(data.users || {}).reduce((total, user) => {
        return total + (user.referrals ? user.referrals.length : 0);
    }, 0);
    
    const statsMessage = `
📊 *SYSTEM STATISTICS* 📊

👥 *Users:*
Total Users: ${totalUsers}
Active Users (24h): ${activeUsers}
New Users Today: ${Object.values(data.users || {}).filter(user => {
    const joined = new Date(user.joinedDate || new Date());
    const today = new Date();
    return joined.toDateString() === today.toDateString();
}).length}
⭐ Manual Premium Users: ${premiumUsers.length}
👥 Total Referrals: ${totalReferrals}

🎁 *Items:*
Total Items: ${totalItems}
Premium Items: ${(data.items || []).filter(item => item.premium_only).length}
File Items: ${(data.items || []).filter(item => item.type !== 'text').length}
Text Items: ${(data.items || []).filter(item => item.type === 'text').length}

💾 *Storage:*
Total Files: ${totalFiles}
Data Size: ${fs.existsSync(DATA_FILE) ? formatFileSize(fs.statSync(DATA_FILE).size) : '0 MB'}
Files Size: ${fs.existsSync(FILES_DIR) ? 
    formatFileSize(fs.readdirSync(FILES_DIR).reduce((total, file) => {
        return total + fs.statSync(path.join(FILES_DIR, file)).size;
    }, 0)) : '0 MB'}

⚙️ *System:*
Admins: ${(data.admins || []).length}
Group Only: ${config.SETTINGS?.groupOnly ? 'Yes' : 'No'}
Cooldown Active: ${Object.keys(data.cooldowns || {}).length} commands
Private Mode: ${data.private_mode?.enabled ? 'Yes' : 'No'}
    `.trim();
    
    await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// Command: Broadcast (Owner only)
bot.onText(/\/broadcast/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'broadcast', 60000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await bot.sendMessage(chatId, 
        '📢 *BROADCAST MESSAGE*\n\nKirim pesan yang ingin disampaikan ke semua user:',
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
    );
});

// Command: Backup (Owner only)
bot.onText(/\/backup/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'backup', 30000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const loadingId = await showLoading(chatId, 'Membackup data', 'system');
    
    const backupData = JSON.stringify(data, null, 2);
    fs.writeFileSync('./backup.json', backupData);
    
    await bot.deleteMessage(chatId, loadingId);
    await bot.sendDocument(chatId, './backup.json', {
        caption: `📦 *BACKUP DATA*\n\nUsers: ${Object.keys(data.users || {}).length}\nItems: ${(data.items || []).length}\nFiles: ${fs.existsSync(FILES_DIR) ? fs.readdirSync(FILES_DIR).length : 0}\nPremium Users: ${(data.premium_users || []).length}`,
        parse_mode: 'Markdown'
    });
});

// Command: Delete Group (Owner only)
bot.onText(/\/deletegroup/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Owner only command!');
        return;
    }
    
    const cooldown = checkCooldown(userId, 'deletegroup', 60000);
    if (cooldown > 0) {
        await bot.sendMessage(chatId, 
            `⏰ *COOLDOWN* - Tunggu ${cooldown} detik lagi`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (!isGroup(chatId)) {
        await bot.sendMessage(chatId, '❌ Command ini hanya bisa digunakan di group!');
        return;
    }
    
    await bot.sendMessage(chatId, 
        '👋 *BOT AKAN KELUAR DARI GROUP*\n\n' +
        'Bot akan meninggalkan group dalam 5 detik...',
        { parse_mode: 'Markdown' }
    );
    
    await sleep(5000);
    await bot.leaveChat(chatId);
});

// ==================== EVENT HANDLERS ====================

// Handle file untuk additem otomatis
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    if (!isAdmin(userId)) return;

    if (!data.ownerAddItemMode || !data.ownerAddItemMode[userId]) return;

    let fileId, fileType, fileName, fileSize;

    if (msg.photo) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
        fileType = 'photo';
        fileName = `photo_${Date.now()}.jpg`;
        fileSize = msg.photo[msg.photo.length - 1].file_size || 0;
    } else if (msg.document) {
        fileId = msg.document.file_id;
        fileType = 'document';
        fileName = msg.document.file_name || `document_${Date.now()}`;
        fileSize = msg.document.file_size || 0;
    } else if (msg.sticker) {
        fileId = msg.sticker.file_id;
        fileType = 'sticker';
        fileName = `sticker_${Date.now()}.webp`;
        fileSize = msg.sticker.file_size || 0;
    } else if (msg.video) {
        fileId = msg.video.file_id;
        fileType = 'video';
        fileName = msg.video.file_name || `video_${Date.now()}.mp4`;
        fileSize = msg.video.file_size || 0;
    } else if (msg.audio) {
        fileId = msg.audio.file_id;
        fileType = 'audio';
        fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`;
        fileSize = msg.audio.file_size || 0;
    } else {
        return;
    }

    // Generate item otomatis
    let itemName = generateItemName(fileName, fileType);
    let rarity = determineRarity(fileSize, fileType);
    let probability = determineProbability(rarity);
    let isPremium = determinePremium(fileType, fileSize);
    
    const rarityEmoji = {
        'LEGENDARY': '💎',
        'EPIC': '🔥',
        'RARE': '⭐', 
        'COMMON': '💧'
    };

    const newItem = {
        id: (data.items || []).length + 1,
        name: `${rarityEmoji[rarity]} ${itemName}`,
        rarity: rarity,
        probability: probability,
        type: fileType,
        file_id: fileId,
        premium_only: isPremium,
        added_date: new Date().toISOString(),
        file_size: fileSize,
        auto_generated: true,
        added_by: userId
    };

    try {
        await downloadFile(fileId, `${newItem.id}_${fileName}`);
    } catch (error) {
        console.log('File download skipped');
    }

    if (!data.items) data.items = [];
    data.items.push(newItem);
    
    data.ownerAddItemMode[userId] = false;
    saveData(data);

    const successMessage = `
✅ *ITEM BERHASIL DITAMBAHKAN OTOMATIS!*

📝 *Nama:* ${newItem.name}
🎯 *Rarity:* ${newItem.rarity} 
📊 *Probability:* ${newItem.probability}%
📁 *Type:* ${newItem.type.toUpperCase()}
⭐ *Premium:* ${newItem.premium_only ? 'Yes' : 'No'}
💾 *Size:* ${formatFileSize(fileSize)}
🆔 *ID:* ${newItem.id}

✨ *Item sudah langsung aktif di gacha!*
    `.trim();

    await bot.sendMessage(msg.chat.id, successMessage, { parse_mode: 'Markdown' });
});

// Handle delete item reply
bot.on('message', async (msg) => {
    if (msg.reply_to_message && 
        msg.reply_to_message.text && 
        msg.reply_to_message.text.includes('DELETE ITEM')) {
        
        const userId = msg.from.id;
        if (!isAdmin(userId)) return;
        
        const itemNumber = parseInt(msg.text);
        const items = data.items || [];
        
        if (isNaN(itemNumber) || itemNumber < 1 || itemNumber > items.length) {
            await bot.sendMessage(msg.chat.id, '❌ Nomor item tidak valid!');
            return;
        }
        
        const itemToDelete = items[itemNumber - 1];
        const itemName = itemToDelete.name;
        
        data.items.splice(itemNumber - 1, 1);
        
        data.items.forEach((item, index) => {
            item.id = index + 1;
        });
        
        saveData(data);
        
        if (itemToDelete.type !== 'text' && itemToDelete.file_id) {
            try {
                const fileName = `${itemToDelete.id}_*`;
                const files = fs.readdirSync(FILES_DIR);
                const fileToDelete = files.find(file => file.startsWith(`${itemToDelete.id}_`));
                if (fileToDelete) {
                    fs.unlinkSync(path.join(FILES_DIR, fileToDelete));
                }
            } catch (error) {
                console.log('Error deleting file:', error);
            }
        }
        
        const successMessage = `
✅ *ITEM BERHASIL DIHAPUS!*

🗑️ *Item yang dihapus:*
${itemName}

📊 *Sisa items:* ${data.items.length} items
🕐 *Waktu:* ${new Date().toLocaleString('id-ID')}

💡 Item telah dihapus permanen dari sistem gacha.
        `.trim();
        
        await bot.sendMessage(msg.chat.id, successMessage, { parse_mode: 'Markdown' });
    }
});

// Handle add premium user reply
bot.on('message', async (msg) => {
    if (msg.reply_to_message && 
        msg.reply_to_message.text && 
        msg.reply_to_message.text.includes('ADD PREMIUM USER')) {
        
        const userId = msg.from.id;
        if (!isAdmin(userId)) return;
        
        const targetUserId = parseInt(msg.text);
        
        if (isNaN(targetUserId)) {
            await bot.sendMessage(msg.chat.id, '❌ User ID harus angka!');
            return;
        }
        
        if (!data.premium_users) data.premium_users = [];
        
        if (data.premium_users.includes(targetUserId)) {
            await bot.sendMessage(msg.chat.id, '❌ User sudah memiliki akses premium!');
            return;
        }
        
        data.premium_users.push(targetUserId);
        saveData(data);
        
        if (!data.users[targetUserId]) {
            data.users[targetUserId] = {
                username: 'Unknown',
                inventory: [],
                gachaCount: 0,
                dailyGacha: 0,
                lastGachaDate: null,
                referrals: [],
                bonusGacha: 0,
                joinedDate: new Date().toISOString(),
                lastActive: new Date().toISOString()
            };
            saveData(data);
        }
        
        const successMessage = `
✅ *PREMIUM ACCESS GRANTED!*

⭐ *User ID:* ${targetUserId}
👤 *Username:* ${data.users[targetUserId]?.username || 'Unknown'}
📅 *Added at:* ${new Date().toLocaleString('id-ID')}
👑 *Added by:* ${msg.from.username}

🎉 User sekarang memiliki akses premium!
• 10x gacha per hari
• Akses item premium  
• Fitur premium lainnya

📊 Total Premium Users: ${data.premium_users.length}
        `.trim();
        
        await bot.sendMessage(msg.chat.id, successMessage, { parse_mode: 'Markdown' });
        
        try {
            await bot.sendMessage(targetUserId, 
                `🎉 *SELAMAT! ANDA MENDAPATKAN AKSES PREMIUM!*\n\n` +
                `Anda telah diberikan akses premium oleh admin.\n\n` +
                `✨ *Fitur Premium yang didapat:*\n` +
                `• 10x gacha per hari\n` +
                `• Akses item premium exclusive\n` +
                `• Priority support\n` +
                `• Dan banyak fitur lainnya!\n\n` +
                `Gunakan /gacha untuk mencoba fitur premium!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log('Cannot notify premium user:', error);
        }
    }
});

// Handle remove premium user reply
bot.on('message', async (msg) => {
    if (msg.reply_to_message && 
        msg.reply_to_message.text && 
        msg.reply_to_message.text.includes('REMOVE PREMIUM USER')) {
        
        const userId = msg.from.id;
        if (!isAdmin(userId)) return;
        
        const userNumber = parseInt(msg.text);
        const premiumUsers = data.premium_users || [];
        
        if (isNaN(userNumber) || userNumber < 1 || userNumber > premiumUsers.length) {
            await bot.sendMessage(msg.chat.id, '❌ Nomor user tidak valid!');
            return;
        }
        
        const userToRemove = premiumUsers[userNumber - 1];
        const username = data.users[userToRemove]?.username || 'Unknown';
        
        data.premium_users.splice(userNumber - 1, 1);
        saveData(data);
        
        const successMessage = `
✅ *PREMIUM ACCESS REMOVED!*

👤 *User:* ${username} (ID: ${userToRemove})
📅 *Removed at:* ${new Date().toLocaleString('id-ID')}
👑 *Removed by:* ${msg.from.username}

💡 User tidak lagi memiliki akses premium manual.

📊 Sisa Premium Users: ${data.premium_users.length}
        `.trim();
        
        await bot.sendMessage(msg.chat.id, successMessage, { parse_mode: 'Markdown' });
        
        try {
            await bot.sendMessage(userToRemove, 
                `ℹ️ *INFORMASI AKUN PREMIUM*\n\n` +
                `Akses premium manual Anda telah dihapus oleh admin.\n\n` +
                `Anda masih bisa mendapatkan akses premium dengan:\n` +
                `• Join channel premium\n` +
                `• Upgrade melalui sistem premium\n\n` +
                `Terima kasih telah menggunakan bot kami!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.log('Cannot notify user:', error);
        }
    }
});

// Handle broadcast reply
bot.on('message', async (msg) => {
    if (msg.reply_to_message && 
        msg.reply_to_message.text && 
        msg.reply_to_message.text.includes('BROADCAST MESSAGE')) {
        
        const userId = msg.from.id;
        if (!isAdmin(userId)) return;
        
        const broadcastMessage = msg.text;
        const users = Object.keys(data.users || {});
        let successCount = 0;
        let failCount = 0;
        
        const loadingId = await showLoading(msg.chat.id, 'Mengirim broadcast');
        
        for (const userID of users) {
            try {
                await bot.sendMessage(userID, 
                    `📢 *BROADCAST FROM ADMIN*\n\n${broadcastMessage}`,
                    { parse_mode: 'Markdown' }
                );
                successCount++;
                await sleep(100);
            } catch (error) {
                failCount++;
            }
        }
        
        await bot.deleteMessage(msg.chat.id, loadingId);
        await bot.sendMessage(msg.chat.id, 
            `📢 *BROADCAST COMPLETE*\n\n` +
            `✅ Berhasil: ${successCount} users\n` +
            `❌ Gagal: ${failCount} users`
        );
    }
});

// ==================== UTILITY FUNCTIONS ====================

function generateItemName(filename, fileType) {
    let name = filename.replace(/\.[^/.]+$/, "");
    name = name.replace(/[_-]/g, " ");
    name = name.replace(/\b\w/g, l => l.toUpperCase());
    
    const typeEmojis = {
        'photo': '🖼️',
        'document': '📄', 
        'sticker': '😊',
        'video': '🎥',
        'audio': '🎵'
    };
    
    const emoji = typeEmojis[fileType] || '📁';
    return `${emoji} ${name}`;
}

function determineRarity(fileSize, fileType) {
    let score = 0;
    
    if (fileSize > 10 * 1024 * 1024) score += 3;
    else if (fileSize > 5 * 1024 * 1024) score += 2; 
    else if (fileSize > 1 * 1024 * 1024) score += 1;
    
    if (fileType === 'sticker') score += 2;
    if (fileType === 'video') score += 2;
    if (fileType === 'audio') score += 1;
    
    if (score >= 4) return 'LEGENDARY';
    if (score >= 3) return 'EPIC';
    if (score >= 2) return 'RARE';
    return 'COMMON';
}

function determineProbability(rarity) {
    const probabilities = {
        'LEGENDARY': Math.floor(Math.random() * 2) + 1,
        'EPIC': Math.floor(Math.random() * 5) + 3,
        'RARE': Math.floor(Math.random() * 10) + 8,
        'COMMON': Math.floor(Math.random() * 30) + 20
    };
    return probabilities[rarity];
}

function determinePremium(fileType, fileSize) {
    if (fileSize > 5 * 1024 * 1024) return true;
    if (fileType === 'video') return true;
    if (fileType === 'sticker') return true;
    return Math.random() < 0.3;
}

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== SPY FUNCTIONS ====================

function logUserActivity(userId, username, action, details = {}) {
    if (!data.spy_settings || !data.spy_settings.enabled) return;
    
    const activity = {
        userId: userId,
        username: username,
        action: action,
        details: details,
        timestamp: new Date().toISOString(),
        ip: details.ip || 'unknown'
    };
    
    spyLog.user_activities.push(activity);
    saveSpyLog(spyLog);
}

function logCommand(userId, username, command, chatId, success = true) {
    if (!data.spy_settings || !data.spy_settings.enabled || !data.spy_settings.log_commands) return;
    
    const commandLog = {
        userId: userId,
        username: username,
        command: command,
        chatId: chatId,
        success: success,
        timestamp: new Date().toISOString()
    };
    
    spyLog.commands_log.push(commandLog);
    saveSpyLog(spyLog);
}

function cleanupOldLogs() {
    const now = new Date();
    const lastCleanup = new Date(spyLog.last_cleanup || now);
    const daysSinceCleanup = (now - lastCleanup) / (1000 * 60 * 60 * 24);
    
    if (daysSinceCleanup >= 1) {
        const cleanupDays = (data.spy_settings && data.spy_settings.auto_cleanup_days) || 30;
        const cutoffDate = new Date(now - cleanupDays * 24 * 60 * 60 * 1000);
        
        spyLog.user_activities = (spyLog.user_activities || []).filter(
            activity => new Date(activity.timestamp) > cutoffDate
        );
        spyLog.commands_log = (spyLog.commands_log || []).filter(
            log => new Date(log.timestamp) > cutoffDate
        );
        
        spyLog.last_cleanup = now.toISOString();
        saveSpyLog(spyLog);
    }
}

// Auto cleanup setiap hari
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

console.log('🤖 Bot Gacha Premium FULL FEATURE berjalan dengan stabil...');
console.log('📊 Data loaded:', Object.keys(data.users || {}).length, 'users');
console.log('🎁 Items loaded:', (data.items || []).length, 'items');
console.log('⭐ Premium users:', (data.premium_users || []).length, 'users');
console.log('🔒 Private mode:', data.private_mode?.enabled ? 'ACTIVE' : 'INACTIVE');
console.log('➕ Add/Del Limit: READY');
console.log('🚀 Bot ready to receive commands!');