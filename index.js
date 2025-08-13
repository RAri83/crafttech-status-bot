require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const ping = require('ping');
const fs = require('fs');
const path = require('path');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const CONFIG = {
    refreshInterval: 30000,
    embedColor: 0x9B59B6,
    footerText: 'Developed by CraftTech Studios',
    statusChannelName: 'Status » {status}',
    playersChannelName: 'Players » 👤 {players}',
    timezone: 'Asia/Tehran'
};

const BANNER = `
 ██████╗██████╗  █████╗ ███████╗████████╗████████╗███████╗ ██████╗██╗  ██╗
██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔════╝██║  ██║
██║     ██████╔╝███████║█████╗     ██║      ██║   █████╗  ██║     ███████║
██║     ██╔══██╗██╔══██║██╔══╝     ██║      ██║   ██╔══╝  ██║     ██╔══██║
╚██████╗██║  ██║██║  ██║██║        ██║      ██║   ███████╗╚██████╗██║  ██║
 ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝      ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝
         📝VERSION» CraftAPI-v3 👤AUTHOR» Farinosa, w_erfan_86                            
`;

let trackingMessage = null;
let lastOnlinePlayers = 0;
let statusChannel = null;
let playersChannel = null;

const DATA_FILE = path.join(__dirname, 'server_stats.json');

function initStats(dateStr) {
    return {
        dayStart: dateStr,
        hourly: {},
        playerSum: 0,
        playerSamples: 0,
        peakPlayers: 0,
        onlineSeconds: 0,
        offlineSeconds: 0,
        transitions: { toOnline: 0, toOffline: 0 },
        lastStatusOnline: null,
        lastCheckTs: null,
        chartMessageId: null,
        lastChartHour: null,
        lastRecapDate: null
    };
}

function readStats() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const today = getIranDateStr();
            const fresh = initStats(today);
            fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), 'utf-8');
            return fresh;
        }
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('Error reading stats file:', e);
        const today = getIranDateStr();
        return initStats(today);
    }
}

function writeStats(stats) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2), 'utf-8');
    } catch (e) {
        console.error('Error writing stats file:', e);
    }
}

let STATS = readStats();

function getIranDate() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: CONFIG.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return {
        dateStr: `${parts.year}-${parts.month}-${parts.day}`,
        hourStr: `${parts.hour}`,
        hourLabel: `${parts.hour}:00`,
        timeLabel: `${parts.hour}:${parts.minute}:${parts.second}`
    };
}

function getIranDateStr() {
    return getIranDate().dateStr;
}

const chartWidth = 900;
const chartHeight = 400;
const chartCanvas = new ChartJSNodeCanvas({ width: chartWidth, height: chartHeight, backgroundColour: 'black' });

async function buildHourlyChartBuffer(stats) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const data = labels.map(lbl => {
        const h = lbl.slice(0, 2);
        const bucket = stats.hourly[h];
        return (!bucket || bucket.samples === 0) ? null : +(bucket.sum / bucket.samples).toFixed(2);
    });

    const configuration = {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Average Players per Hour',
                data
            }]
        },
        options: {
            responsive: false,
            animation: false,
            plugins: {
                legend: { display: true },
                title: {
                    display: true,
                    text: `Hourly Players • ${stats.dayStart}`
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            }
        }
    };

    return await chartCanvas.renderToBuffer(configuration);
}

function showStartupInfo() {
    console.clear();
    console.log('\x1b[35m' + BANNER + '\x1b[0m');
    console.log('\x1b[32m🟢 Bot is starting...\x1b[0m');
    console.log('\x1b[34m──────────────────────────────\x1b[0m');
}

async function getMCServerStatus(ip) {
    try {
        const cleanIP = ip.includes(':') ? ip.split(':')[0] : ip;
        const port = ip.includes(':') ? ip.split(':')[1] : '25565';
        const response = await fetch(`https://api.mcstatus.io/v2/status/java/${cleanIP}:${port}`);
        if (!response.ok) return { online: false };
        const data = await response.json();
        return (data && typeof data.online !== 'undefined') ? data : { online: false };
    } catch (error) {
        console.error('Error fetching server status:', error.message);
        return { online: false };
    }
}

async function getServerPing(ip) {
    try {
        const cleanIP = ip.includes(':') ? ip.split(':')[0] : ip;
        const res = await ping.promise.probe(cleanIP);
        return (res && res.time) ? `${Math.round(res.time)}ms` : 'N/A';
    } catch (error) {
        console.error('Ping API error:', error.message);
        return 'N/A';
    }
}

async function getServerLocation(ip) {
    try {
        const host = ip.includes(':') ? ip.split(':')[0] : ip;
        const res = await fetch(`http://ip-api.com/json/${host}`);
        const data = await res.json();
        return (data && data.status === 'success') ? `${data.country} - ${data.city || 'Unknown City'}` : 'Unknown Location';
    } catch (error) {
        console.error('Location API error:', error.message);
        return 'Unknown Location';
    }
}

async function getServerISP(ip) {
    try {
        const host = ip.includes(':') ? ip.split(':')[0] : ip;
        const res = await fetch(`http://ip-api.com/json/${host}`);
        const data = await res.json();
        return (data && data.status === 'success') ? data.isp || 'Unknown ISP' : 'Unknown ISP';
    } catch (error) {
        console.error('ISP API error:', error.message);
        return 'Unknown ISP';
    }
}

async function createServerEmbed(ip) {
    try {
        const [serverData, pingTime, location, isp] = await Promise.all([
            getMCServerStatus(ip),
            getServerPing(ip),
            getServerLocation(ip),
            getServerISP(ip)
        ]);

        const embed = new EmbedBuilder()
            .setColor(CONFIG.embedColor)
            .setFooter({
                text: CONFIG.footerText
            });

        if (process.env.FOOTER_IMAGE_URL) {
            embed.setImage(`https://${process.env.FOOTER_IMAGE_URL}`);
        }

        if (!serverData.online) {
            embed.setTitle('🔴 Server Offline')
                .setDescription('The Minecraft server is currently offline or unreachable.')
                .addFields({ name: 'Server IP', value: ip, inline: true });
            lastOnlinePlayers = 0;
            return embed;
        }

        let gameModes = [];
        if (serverData.players?.list) {
            const modes = new Set();
            serverData.players.list.forEach(player => {
                if (player.name_clean) {
                    const cleanedName = player.name_clean.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, '').trim();
                    if (cleanedName && !cleanedName.toLowerCase().includes('discord') && /\d/.test(cleanedName)) {
                        modes.add(`🎲 ${cleanedName}`);
                    }
                }
            });
            gameModes = modes.size > 0 ? Array.from(modes).join('\n') : 'No active game modes';
        }

        const version = serverData.version?.name_raw || 'Unknown';
        const playersOnline = serverData.players?.online || 0;
        lastOnlinePlayers = playersOnline;

        const iconUrl = `https://api.mcstatus.io/v2/icon/${ip.includes(':') ? ip.split(':')[0] : ip}`;

        embed.setTitle(`🟢 ${serverData.motd?.clean || 'Minecraft Server'}`)
            .setThumbnail(iconUrl)
            .addFields(
                { name: '🛡️ Version', value: version, inline: true },
                { name: '👥 Players', value: `${playersOnline}/${serverData.players?.max || 0}`, inline: true },
                { name: '📶 Ping', value: pingTime, inline: true },
                { name: '📡 Server IP', value: ip, inline: false },
                { name: '🌍 Location', value: location, inline: true },
                { name: '🖥️ ISP', value: isp, inline: true },
                { name: '🎮 Game Mode', value: gameModes, inline: false }
            );

        return embed;
    } catch (error) {
        console.error('Error creating embed:', error);
        return null;
    }
}

async function updateDynamicChannels(serverStatus) {
    try {
        if (!process.env.STATUS_CATEGORY_ID || process.env.STATUS_CATEGORY_ID === '0') return;

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        const category = guild.channels.cache.get(process.env.STATUS_CATEGORY_ID);
        if (!category || category.type !== ChannelType.GuildCategory) return;

        const serverIP = process.env.SERVER_IP;
        const statusText = serverStatus.online ? '🟢 Online' : '🔴 Offline';
        const playersText = serverStatus.online ? `${serverStatus.players?.online || 0}` : '0';

        if (!statusChannel) {
            const existingChannels = guild.channels.cache.filter(ch => 
                ch.parentId === category.id && ch.name.startsWith('Status »'));
            statusChannel = existingChannels.size > 0 ? existingChannels.first() : 
                await guild.channels.create({
                    name: CONFIG.statusChannelName.replace('{status}', statusText),
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    permissionOverwrites: [{
                        id: guild.roles.everyone.id,
                        deny: ['Connect']
                    }]
                });
        } else {
            await statusChannel.setName(CONFIG.statusChannelName.replace('{status}', statusText));
        }

        if (serverStatus.online) {
            if (!playersChannel) {
                const existingPlayersChannels = guild.channels.cache.filter(ch => 
                    ch.parentId === category.id && ch.name.startsWith('Players »'));
                playersChannel = existingPlayersChannels.size > 0 ? existingPlayersChannels.first() : 
                    await guild.channels.create({
                        name: CONFIG.playersChannelName.replace('{players}', playersText),
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: [{
                            id: guild.roles.everyone.id,
                            deny: ['Connect']
                        }]
                    });
            } else {
                await playersChannel.setName(CONFIG.playersChannelName.replace('{players}', playersText));
            }
        } else if (playersChannel) {
            try {
                await playersChannel.delete();
                playersChannel = null;
            } catch (error) {
                console.error('Error deleting players channel:', error);
                playersChannel = null;
            }
        }

        await category.setName(serverStatus.online ? serverIP : 'Minecraft server status');
    } catch (error) {
        console.error('Error updating dynamic channels:', error);
    }
}

function updateBotStatus(serverStatus) {
    try {
        const statusText = serverStatus.online ?
            `👥 ${lastOnlinePlayers} Player${lastOnlinePlayers !== 1 ? 's' : ''}` :
            'Server is offline';

        client.user.setPresence({
            activities: [{ name: statusText, type: 3 }],
            status: 'online'
        });
    } catch (error) {
        console.error('Error updating bot status:', error);
    }
}

function updateInMemoryStats(serverStatus) {
    const { dateStr, hourStr } = getIranDate();
    const nowMs = Date.now();

    if (STATS.lastCheckTs !== null) {
        const deltaSec = Math.max(0, Math.round((nowMs - STATS.lastCheckTs) / 1000));
        if (serverStatus.online) STATS.onlineSeconds += deltaSec;
        else STATS.offlineSeconds += deltaSec;
    }
    STATS.lastCheckTs = nowMs;

    if (STATS.lastStatusOnline === null) {
        STATS.lastStatusOnline = !!serverStatus.online;
    } else if (STATS.lastStatusOnline !== !!serverStatus.online) {
        if (serverStatus.online) STATS.transitions.toOnline += 1;
        else STATS.transitions.toOffline += 1;
        STATS.lastStatusOnline = !!serverStatus.online;
    }

    const playersOnline = serverStatus.online ? (serverStatus.players?.online || 0) : 0;
    if (!STATS.hourly[hourStr]) STATS.hourly[hourStr] = { sum: 0, samples: 0 };
    STATS.hourly[hourStr].sum += playersOnline;
    STATS.hourly[hourStr].samples += 1;

    STATS.playerSum += playersOnline;
    STATS.playerSamples += 1;

    writeStats(STATS);
}

async function handleHourlyChartUpdate(serverStatus) {
    try {
        if (!process.env.CHART_CHANNEL_ID || process.env.CHART_CHANNEL_ID === '0') return;

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        const chartChannel = guild.channels.cache.get(process.env.CHART_CHANNEL_ID);
        if (!chartChannel) return;

        const { hourStr } = getIranDate();
        
        if (STATS.lastChartHour === hourStr) return;

        console.log(`Updating chart for hour ${hourStr}`);

        const buffer = await buildHourlyChartBuffer(STATS);
        const fileName = `players_chart_${STATS.dayStart}.png`;
        const attachment = new AttachmentBuilder(buffer, { name: fileName });

        const chartEmbed = new EmbedBuilder()
            .setColor(CONFIG.embedColor)
            .setTitle(`📊 Hourly Players • ${STATS.dayStart}`)
            .setDescription('میانگین تعداد بازیکنان در هر ساعت (به وقت آسیا/تهران)')
            .setImage(`attachment://${fileName}`)
            .setTimestamp(new Date());

        if (STATS.chartMessageId) {
            try {
                const msg = await chartChannel.messages.fetch(STATS.chartMessageId);
                await msg.edit({ embeds: [chartEmbed], files: [attachment] });
                console.log('Chart message updated successfully');
            } catch (e) {
                console.log('Failed to edit chart message, sending new one...');
                const newMsg = await chartChannel.send({ embeds: [chartEmbed], files: [attachment] });
                STATS.chartMessageId = newMsg.id;
            }
        } else {
            const newMsg = await chartChannel.send({ embeds: [chartEmbed], files: [attachment] });
            STATS.chartMessageId = newMsg.id;
        }

        STATS.lastChartHour = hourStr;
        writeStats(STATS);
    } catch (e) {
        console.error('Error updating hourly chart:', e);
    }
}

async function handleDailyRecapIfNeeded() {
    try {
        if (!process.env.RECAP_CHANNEL_ID || process.env.RECAP_CHANNEL_ID === '0') return;

        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) return;

        const recapChannel = guild.channels.cache.get(process.env.RECAP_CHANNEL_ID);
        if (!recapChannel) return;

        const { dateStr } = getIranDate();
        if (STATS.dayStart === dateStr) return;

        console.log('Preparing daily recap...');

        const prev = { ...STATS };
        let avg = 0;
        if (prev.playerSamples > 0) avg = +(prev.playerSum / prev.playerSamples).toFixed(2);

        let hourlyAverages = [];
        for (let h = 0; h < 24; h++) {
            const key = String(h).padStart(2, '0');
            const bucket = prev.hourly[key];
            if (bucket && bucket.samples > 0) {
                hourlyAverages.push(bucket.sum / bucket.samples);
            }
        }
        const peak = hourlyAverages.length ? Math.max(...hourlyAverages) : 0;
        const peakRounded = Math.round(peak);

        const onlineHMS = secToHMS(prev.onlineSeconds);
        const offlineHMS = secToHMS(prev.offlineSeconds);

        const recapEmbed = new EmbedBuilder()
            .setColor(CONFIG.embedColor)
            .setTitle(`🗓️ Daily Recap • ${prev.dayStart}`)
            .addFields(
                { name: '⏱️ Online Time', value: onlineHMS, inline: true },
                { name: '🔌 Offline Time', value: offlineHMS, inline: true },
                { name: '🔄 Status Switches', value: `⬆️ to Online: ${prev.transitions.toOnline}\n⬇️ to Offline: ${prev.transitions.toOffline}`, inline: true },
                { name: '👥 Average Players', value: `${avg}`, inline: true },
                { name: '🏔️ Peak (hourly avg)', value: `${peakRounded}`, inline: true }
            )
            .setTimestamp(new Date())
            .setFooter({ text: CONFIG.footerText });

        await recapChannel.send({ embeds: [recapEmbed] });
        STATS.lastRecapDate = prev.dayStart;

        const newStats = initStats(dateStr);
        newStats.chartMessageId = STATS.chartMessageId;
        STATS = newStats;
        writeStats(STATS);

        await handleHourlyChartUpdate({ online: false, players: { online: 0 } });
    } catch (e) {
        console.error('Error handling daily recap:', e);
    }
}

function secToHMS(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function updateTrackerMessage() {
    try {
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (!guild) {
            console.error('\x1b[31m⚠️ Guild not found\x1b[0m');
            return;
        }

        const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
        if (!channel) {
            console.error('\x1b[31m⚠️ Channel not found\x1b[0m');
            return;
        }

        console.log('Fetching server status...');
        const serverStatus = await getMCServerStatus(process.env.SERVER_IP);
        const embed = await createServerEmbed(process.env.SERVER_IP);
        if (!embed) return;

        await updateDynamicChannels(serverStatus);
        updateBotStatus(serverStatus);
        updateInMemoryStats(serverStatus);
        await handleDailyRecapIfNeeded();
        await handleHourlyChartUpdate(serverStatus);

        if (!trackingMessage) {
            console.log('Looking for existing tracking message...');
            const messages = await channel.messages.fetch({ limit: 10 });
            trackingMessage = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        }

        if (trackingMessage) {
            try {
                console.log('Editing existing message...');
                await trackingMessage.edit({ embeds: [embed] });
                console.log('Message edited successfully');
            } catch (error) {
                console.error('\x1b[33m⚠️ Failed to edit message, sending new one...\x1b[0m');
                trackingMessage = await channel.send({ embeds: [embed] });
            }
        } else {
            console.log('Sending new message...');
            trackingMessage = await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('\x1b[31m⚠️ Error in updateTrackerMessage:\x1b[0m', error);
    }
}

client.once('ready', async () => {
    showStartupInfo();
    console.log('\x1b[32m✅ Logged in as %s\x1b[0m', client.user.tag);
    console.log('\x1b[34m🔍 Tracking server: %s\x1b[0m', process.env.SERVER_IP);

    if (process.env.STATUS_CATEGORY_ID && process.env.STATUS_CATEGORY_ID !== '0') {
        const guild = client.guilds.cache.get(process.env.GUILD_ID);
        if (guild) {
            const category = guild.channels.cache.get(process.env.STATUS_CATEGORY_ID);
            if (category) {
                const channels = guild.channels.cache.filter(ch => ch.parentId === category.id);
                statusChannel = channels.find(ch => ch.name.startsWith('Status »'));
                playersChannel = channels.find(ch => ch.name.startsWith('Players »'));
            }
        }
    }

    await updateTrackerMessage();
    const interval = setInterval(updateTrackerMessage, CONFIG.refreshInterval);
    process.on('exit', () => clearInterval(interval));
});

client.login(process.env.TOKEN).catch(err => {
    console.error('\x1b[31m⚠️ Failed to login:\x1b[0m', err);
    process.exit(1);
});
