import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileTicketPanels, reconcileVerificationPanels } from "../services/panelHealthService.js";
import { cleanupCustomVoiceRooms } from "../services/customVoiceCreateService.js";
import { checkBirthdays } from "../services/birthdayService.js";
import { sortCategories } from "../utils/categoryOrder.js";
import { initStatusReporter } from "../utils/statusReporter.js";
import { migrateOldWelcomeMessages } from "../utils/welcomeMigration.js";
import { cleanupLiveChannelOnce } from "../services/twitchLiveService.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      initStatusReporter(client);
      migrateOldWelcomeMessages(client).catch(() => {}); // läuft im Hintergrund
      cleanupLiveChannelOnce(client).catch(() => {});
      await cleanupCustomVoiceRooms(client);
      startupLog("Custom voice rooms cleaned up");

      // Falls der Bot um Mitternacht offline war: heutige Gratulation nachholen (nur einmal pro Tag).
      await checkBirthdays(client);

      for (const guild of client.guilds.cache.values()) {
        const failed = await sortCategories(guild);
        if (failed.length > 0) startupLog(`Kategorien nicht verschiebbar (Bot ohne Zugriff): ${failed.join(', ')}`);
      }

      const ticketPanelSummary = await reconcileTicketPanels(client);
      startupLog(
        `Ticket panel health: scanned ${ticketPanelSummary.scannedGuilds} guilds, healthy ${ticketPanelSummary.healthyPanels}, deleted ${ticketPanelSummary.deletedPanels}, missing channel ${ticketPanelSummary.missingChannels}, recovered ${ticketPanelSummary.recoveredIds}, errors ${ticketPanelSummary.errors}`
      );

      const verificationPanelSummary = await reconcileVerificationPanels(client);
      startupLog(
        `Verification panel health: scanned ${verificationPanelSummary.scannedGuilds} guilds, healthy ${verificationPanelSummary.healthyPanels}, deleted ${verificationPanelSummary.deletedPanels}, missing channel ${verificationPanelSummary.missingChannels}, recovered ${verificationPanelSummary.recoveredIds}, errors ${verificationPanelSummary.errors}`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
