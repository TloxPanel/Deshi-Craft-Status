const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { readdirSync } = require('fs');
const { join } = require('path');
const http = require('http');
require('dotenv').config();

const config = require('./config');
const logger = require('./utils/logger');

// Create Discord client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ]
});

// Create commands collection
client.commands = new Collection();
client.cooldowns = new Collection();

// Load commands
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const commands = [];
for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
        logger.system(`Command module loaded: ${command.data.name}`);
    } else {
        console.log(`⚠️ Command at ${filePath} is missing required "data" or "execute" property.`);
    }
}

// Bot ready event
client.once('ready', async () => {
    logger.system(`DeshiCraft Monitor v${config.bot.version} initialized successfully`);
    logger.system(`Connected to ${client.guilds.cache.size} Discord guild(s)`);
    logger.system(`Monitoring target server: ${config.server.address}`);
    logger.system(`System developed by Foysal (Discord: onion.orbit)`);
    logger.system(`Production environment active - Enterprise monitoring enabled`);
    
    // Set bot activity
    client.user.setActivity('DeshiCraft Infrastructure | Developed by Foysal', { type: 'WATCHING' });
    
    try {
        // Register slash commands
        const rest = new REST().setToken(process.env.DISCORD_TOKEN);
        logger.system('Deploying application command modules');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        logger.system('Application command deployment completed successfully');
    } catch (error) {
        logger.error('Command deployment failed', error, { phase: 'registration' });
    }
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command) {
            console.error(`❌ No command matching ${interaction.commandName} was found.`);
            return;
        }
        
        // Check cooldowns
        const { cooldowns } = client;
        
        if (!cooldowns.has(command.data.name)) {
            cooldowns.set(command.data.name, new Collection());
        }
        
        const now = Date.now();
        const timestamps = cooldowns.get(command.data.name);
        const defaultCooldownDuration = config.bot.cooldown;
        const cooldownAmount = (command.cooldown ?? defaultCooldownDuration);
        
        if (timestamps.has(interaction.user.id)) {
            const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
            
            if (now < expirationTime) {
                const expiredTimestamp = Math.round(expirationTime / 1000);
                return interaction.reply({
                    content: `⏰ Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
                    flags: ['Ephemeral']
                });
            }
        }
        
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
        
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`❌ Error executing ${interaction.commandName}:`, error);
            
            const errorMessage = {
                content: '❌ There was an error while executing this command!',
                flags: ['Ephemeral']
            };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
    
    // Handle button interactions
    if (interaction.isButton()) {
        const minecraftUtils = require('./utils/minecraftUtils');
        const embedUtils = require('./utils/embedUtils');
        
        if (interaction.customId.startsWith('players_')) {
            const serverAddress = interaction.customId.replace('players_', '');
            
            try {
                await interaction.deferReply({ ephemeral: true });
                
                const serverData = await minecraftUtils.queryServer(serverAddress);
                
                if (!serverData.online) {
                    return interaction.editReply({
                        content: '❌ DeshiCraft server is currently offline or unreachable.',
                    });
                }
                
                const playersEmbed = embedUtils.createPlayersEmbed(serverData, serverAddress);
                await interaction.editReply({ embeds: [playersEmbed] });
                
            } catch (error) {
                console.error('❌ Error fetching player list:', error);
                
                try {
                    if (interaction.deferred) {
                        await interaction.editReply({
                            content: '❌ Failed to fetch player list. DeshiCraft server may be offline or unreachable.'
                        });
                    } else {
                        await interaction.reply({
                            content: '❌ Failed to fetch player list. DeshiCraft server may be offline or unreachable.',
                            ephemeral: true
                        });
                    }
                } catch (e) {
                    console.error('❌ Failed to send error response:', e);
                }
            }
        }
        
        if (interaction.customId.startsWith('refresh_')) {
            const serverAddress = interaction.customId.replace('refresh_', '');
            
            try {
                await interaction.deferUpdate();
                
                const serverData = await minecraftUtils.queryServer(serverAddress);
                
                let embed;
                let components = [];
                
                if (serverData.online) {
                    embed = embedUtils.createServerEmbed(serverData, serverAddress, true);
                    
                    // Add refresh button
                    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                    const refreshButton = new ButtonBuilder()
                        .setCustomId(`refresh_${serverAddress}`)
                        .setLabel('🔄 Refresh Status')
                        .setStyle(ButtonStyle.Secondary);
                    
                    const buttons = [refreshButton];
                    
                    if (serverData.players && serverData.players.online > 0) {
                        const playersButton = new ButtonBuilder()
                            .setCustomId(`players_${serverAddress}`)
                            .setLabel(`👥 View Players (${serverData.players.online})`)
                            .setStyle(ButtonStyle.Primary);
                        
                        buttons.push(playersButton);
                    }
                    
                    const row = new ActionRowBuilder().addComponents(buttons);
                    components.push(row);
                    
                } else {
                    embed = embedUtils.createOfflineEmbed(serverAddress, serverData.error);
                    
                    const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                    const refreshButton = new ButtonBuilder()
                        .setCustomId(`refresh_${serverAddress}`)
                        .setLabel('🔄 Try Again')
                        .setStyle(ButtonStyle.Secondary);
                    
                    const row = new ActionRowBuilder().addComponents(refreshButton);
                    components.push(row);
                }
                
                // Add timestamp
                embed.setFooter({ 
                    text: `DeshiCraft Monitor • Made by Foysal (Discord: onion.orbit) • Last updated: ${new Date().toLocaleTimeString()}`,
                    iconURL: 'https://cdn.discordapp.com/attachments/placeholder/minecraft-icon.png'
                });
                
                await interaction.editReply({ 
                    embeds: [embed], 
                    components: components 
                });
                
            } catch (error) {
                console.error('❌ Error refreshing server status:', error);
                
                try {
                    const errorEmbed = embedUtils.createErrorEmbed(
                        'Refresh Failed',
                        `Failed to refresh DeshiCraft server status: ${minecraftUtils.formatErrorMessage(error)}`,
                        { 
                            color: config.colors.error,
                            footer: { text: 'DeshiCraft Monitor • Made by Foysal (Discord: onion.orbit)' }
                        }
                    );
                    
                    await interaction.editReply({ embeds: [errorEmbed], components: [] });
                } catch (e) {
                    console.error('❌ Failed to send refresh error response:', e);
                }
            }
        }
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Simple web server for deployment
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <html>
            <head>
                <title>DeshiCraft Server Monitor</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #2f3136; color: white; }
                    .container { max-width: 600px; margin: 0 auto; text-align: center; }
                    .status { background: #57f287; color: black; padding: 10px; border-radius: 5px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎮 DeshiCraft Server Monitor</h1>
                    <div class="status">✅ Bot is online and running</div>
                    <p>Discord bot is monitoring: <strong>${config.server.address}</strong></p>
                    <p>Version: ${config.bot.version}</p>
                    <p>Developed by Foysal (Discord: onion.orbit)</p>
                </div>
            </body>
        </html>
    `);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server running on http://0.0.0.0:${PORT}`);
});

// Login to Discord
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN not found in environment variables!');
    process.exit(1);
}

client.login(token).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
