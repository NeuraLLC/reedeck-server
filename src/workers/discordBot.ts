/**
 * Discord Gateway Bot Worker
 *
 * Connects to Discord via WebSocket Gateway to receive MESSAGE_CREATE events.
 * Discord doesn't send message events to HTTP endpoints — only the Gateway
 * WebSocket delivers them. This worker listens for messages and processes
 * them using the shared discordMessageProcessor service.
 */

import { Client, GatewayIntentBits, Events } from 'discord.js';
import logger from '../config/logger';
import { processDiscordMessage } from '../services/discordMessageProcessor';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  logger.warn('[DISCORD BOT] DISCORD_BOT_TOKEN not set — Discord bot worker will not start');
} else {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`[DISCORD BOT] Logged in as ${readyClient.user.tag}`);
    logger.info(`[DISCORD BOT] Serving ${readyClient.guilds.cache.size} guild(s)`);
  });

  client.on(Events.MessageCreate, async (msg) => {
    // Skip bot messages
    if (msg.author.bot) return;

    const guildId = msg.guildId;
    if (!guildId) return; // DMs — ignore for now

    try {
      await processDiscordMessage(
        {
          id: msg.id,
          content: msg.content,
          channel_id: msg.channelId,
          author: {
            id: msg.author.id,
            username: msg.author.username,
            bot: msg.author.bot,
          },
        },
        guildId
      );
    } catch (error) {
      logger.error('[DISCORD BOT] Error processing message:', error);
    }
  });

  client.on(Events.Error, (error) => {
    logger.error('[DISCORD BOT] Client error:', error);
  });

  client.login(DISCORD_BOT_TOKEN).catch((error) => {
    logger.error('[DISCORD BOT] Failed to login:', error);
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('[DISCORD BOT] Shutting down...');
    client.destroy();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
