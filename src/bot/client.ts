import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import type { Database } from "bun:sqlite";
import type pino from "pino";
import type { Config } from "../config.ts";
import { commands, handleCommand } from "./commands.ts";
import type { EnrichedAlert } from "../enricher/funding.ts";
import { buildEmbed } from "../enricher/message.ts";

export type BotState = {
  startedAt: string;
  tickCount: number;
  totalAlertsSent: number;
};

export async function createBot(opts: {
  readonly token: string;
  readonly guildId: string;
  readonly alertChannelId: string;
  readonly db: Database;
  readonly envConfig: Config;
  readonly logger: pino.Logger;
  readonly getState: () => BotState;
}): Promise<{
  client: Client;
  sendAlertToChannel: (alert: EnrichedAlert, ts: string) => Promise<boolean>;
}> {
  const { token, guildId, alertChannelId, db, envConfig, logger, getState } = opts;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  // Register slash commands
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(client.application?.id ?? "", guildId), {
      body: commands,
    });
    logger.info("slash commands registered");
  } catch {
    // Commands will be registered after login when we have application ID
  }

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ user: readyClient.user.tag }, "Discord bot online");
    // Register commands after we have the application ID
    try {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), {
        body: commands,
      });
      logger.info("slash commands registered");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "failed to register slash commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      const state = getState();
      await handleCommand(
        interaction as ChatInputCommandInteraction,
        db,
        envConfig,
        state.startedAt,
        state.tickCount,
        state.totalAlertsSent,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message, command: interaction.commandName }, "command handler error");
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => {});
      }
    }
  });

  await client.login(token);

  async function sendAlertToChannel(alert: EnrichedAlert, ts: string): Promise<boolean> {
    try {
      const channel = await client.channels.fetch(alertChannelId);
      if (!channel?.isTextBased()) {
        logger.error({ channelId: alertChannelId }, "alert channel not found or not text");
        return false;
      }
      const embed = buildEmbed(alert, ts);
      await (channel as TextChannel).send({ embeds: [embed as Record<string, unknown>] });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, "failed to send alert to channel");
      return false;
    }
  }

  return { client, sendAlertToChannel };
}
