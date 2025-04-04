require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch').default;
const ping = require('ping');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CONFIG = {
  refreshInterval: 30000,
  embedColor: 0x9B59B6,
  footerText: 'Developed by CraftTech Studios'
};

const BANNER = `
 ██████╗██████╗  █████╗ ███████╗████████╗████████╗███████╗ ██████╗██╗  ██╗
██╔════╝██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔════╝██║  ██║
██║     ██████╔╝███████║█████╗     ██║      ██║   █████╗  ██║     ███████║
██║     ██╔══██╗██╔══██║██╔══╝     ██║      ██║   ██╔══╝  ██║     ██╔══██║
╚██████╗██║  ██║██║  ██║██║        ██║      ██║   ███████╗╚██████╗██║  ██║
 ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝      ╚═╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝
         📝VERSION» CraftAPI-v1 👤AUTHOR» Farinosa, w_erfan_86                            
`;

let trackingMessage = null;
let lastOnlinePlayers = 0;

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
    if (!response.ok) {
      if (response.status === 404) {
        return { online: false };
      }
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.online === 'undefined') {
      throw new Error('Invalid server response');
    }

    return data;
  } catch (error) {
    console.error('\x1b[31m⚠️ Error fetching server status:\x1b[0m', error.message);
    return { online: false };
  }
}

async function getServerPing(ip) {
  try {
    const cleanIP = ip.includes(':') ? ip.split(':')[0] : ip;
    const res = await ping.promise.probe(cleanIP);
    if (res && res.time) {
      return `${Math.round(res.time)}ms`;
    }
    return 'N/A';
  } catch (error) {
    console.error('\x1b[33m⚠️ Ping API error:\x1b[0m', error.message);
    return 'N/A';
  }
}

async function getServerLocation(ip) {
  try {
    const host = ip.includes(':') ? ip.split(':')[0] : ip;
    const res = await fetch(`http://ip-api.com/json/${host}`);
    const data = await res.json();

    if (data && data.status === 'success') {
      return `${data.country} - ${data.city || 'Unknown City'}`;
    }

    return 'Unknown Location';
  } catch (error) {
    console.error('\x1b[33m⚠️ Location API error:\x1b[0m', error.message);
    return 'Unknown Location';
  }
}

async function getServerISP(ip) {
  try {
    const host = ip.includes(':') ? ip.split(':')[0] : ip;
    const res = await fetch(`http://ip-api.com/json/${host}`);
    const data = await res.json();

    if (data && data.status === 'success') {
      return data.isp || 'Unknown ISP';
    }

    return 'Unknown ISP';
  } catch (error) {
    console.error('\x1b[33m⚠️ ISP API error:\x1b[0m', error.message);
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
        text: CONFIG.footerText,
        iconURL: process.env.FOOTER_IMAGE_URL
      });

    if (!serverData.online) {
      embed.setTitle('🔴 Server Offline')
        .setDescription('The Minecraft server is currently offline or unreachable.')
        .addFields(
          { name: 'Server IP', value: ip, inline: true }
        );
      lastOnlinePlayers = 0;
      return embed;
    }

    const gameModes = serverData.players && serverData.players.list
      ? serverData.players.list
        .filter(player => /\d/.test(player.name_clean))
        .map(player => {
          const cleanedName = player.name_clean.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, '');
          return `🎲${cleanedName.trim()}`;
        })
        .filter(mode => !mode.toLowerCase().includes('discord'))
        .join('\n')
      : 'N/A';

    const version = serverData.version?.name_raw || 'Unknown';
    const playersOnline = serverData.players?.online || 0;
    lastOnlinePlayers = playersOnline;

    const iconUrl = `https://api.mcstatus.io/v2/icon/${ip.includes(':') ? ip.split(':')[0] : ip}`;

    embed.setTitle(`🟢 ${serverData.motd?.clean || 'Minecraft Server'}`)
      .setThumbnail(iconUrl)
      .addFields(
        { name: '🛡️ Version', value: version, inline: true },
        { name: '👥 Players', value: `${playersOnline}/${serverData.players?.max || 0}`, inline: true },
        { name: '📶 Ping', value: `${pingTime}`, inline: true },
        { name: '📡 Server IP', value: ip, inline: false },
        { name: '🌍 Location', value: location, inline: true },
        { name: '🖥️ ISP', value: isp, inline: true },
        { name: '🎮 Game Mode', value: gameModes, inline: false }
      );

    return embed;
  } catch (error) {
    console.error('\x1b[31m⚠️ Error creating embed:\x1b[0m', error);
    return null;
  }
}

function updateBotStatus() {
  try {
    const statusText = `👥 ${lastOnlinePlayers} Player${lastOnlinePlayers !== 1 ? 's' : ''}`;

    client.user.setPresence({
      activities: [{
        name: statusText,
        type: 3
      }],
      status: 'online'
    });
  } catch (error) {
    console.error('\x1b[31m⚠️ Error updating bot status:\x1b[0m', error);
  }
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

    const embed = await createServerEmbed(process.env.SERVER_IP);
    if (!embed) return;

    updateBotStatus();

    if (!trackingMessage) {
      const msg = await channel.send({ embeds: [embed] });
      trackingMessage = msg;
      console.log('\x1b[32m📢 Tracking message sent successfully\x1b[0m');
    } else {
      try {
        await trackingMessage.edit({ embeds: [embed] });
        console.log('\x1b[34m🔄 Tracking message updated\x1b[0m');
      } catch (error) {
        console.error('\x1b[31m⚠️ Error editing message:\x1b[0m', error);
        trackingMessage = await channel.send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('\x1b[31m⚠️ Error in updateTrackerMessage:\x1b[0m', error);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('\x1b[31m⚠️ Unhandled Rejection at:\x1b[0m', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('\x1b[31m⚠️ Uncaught Exception thrown:\x1b[0m', err);
});

process.on('SIGINT', async () => {
  console.log('\x1b[33m\n🛑 Logging out and shutting down gracefully...\x1b[0m');
  await client.destroy();
  process.exit(0);
});

client.once('ready', () => {
  showStartupInfo();
  console.log('\x1b[32m✅ Logged in as %s\x1b[0m', client.user.tag);
  console.log('\x1b[34m🔍 Tracking server: %s\x1b[0m', process.env.SERVER_IP);
  console.log('\x1b[34m──────────────────────────────\x1b[0m');

  updateTrackerMessage();
  const interval = setInterval(() => {
    updateTrackerMessage();
    console.log('\x1b[34m⏳ Refreshing server status...\x1b[0m');
  }, CONFIG.refreshInterval);

  process.on('exit', () => clearInterval(interval));
});

client.login(process.env.TOKEN).catch(err => {
  console.error('\x1b[31m⚠️ Failed to login:\x1b[0m', err);
  process.exit(1);
});
