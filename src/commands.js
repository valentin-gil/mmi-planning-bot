const { ApplicationCommandOptionType } = require("discord.js");
const groups = require("../groups");
const { DEV_GUILD_ID } = require("./config");

function getGlobalCommands() {
  return [
    {
      name: "mes-options",
      description: "Affiche tes préférences de notification (groupe / mention / mp)",
    },
  ];
}

function getTestGuildCommands() {
  const rawChoices = groups.map((g) => ({
    name: String(g.nom),
    value: String(g.nom),
  }));
  const choices = rawChoices.slice(0, 25);
  return [
    {
      name: "simulate",
      description: "Simule un changement pour un groupe (test)",
      options: [
        {
          name: "group",
          description: "Nom du groupe",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices,
        },
        {
          name: "change_type",
          description: "Type de changement à simuler",
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: [
            { name: "Nouveau cours", value: "added" },
            { name: "Cours supprimé", value: "removed" },
            { name: "Cours modifié", value: "modified" },
            { name: "Changement de salle", value: "location" },
          ],
        },
      ],
    },
  ];
}

async function registerCommands(client) {
  await client.application.commands.set(getGlobalCommands());
  try {
    const guild = await client.guilds.fetch(DEV_GUILD_ID);
    await guild.commands.set(getTestGuildCommands());
  } catch (guildErr) {
    console.error(
      "Impossible d'enregistrer la commande simulate sur la guilde de test :",
      guildErr
    );
  }
}

async function handleSlashCommand(
  interaction,
  client,
  groups,
  subscriptions,
  wantsDM,
  fetchEvents,
  buildChangeEmbed,
  shiftDateStrByHours,
  sendEmbedToChannels,
  sendEmbedDMs,
  ROLE_CHANNEL_MAP
) {
  if (interaction.commandName === "mes-options") {
    const userId = interaction.user.id;
    const sub = subscriptions[userId];
    if (!sub) {
      return interaction.reply({
        content: "Tu n'as pas d'options enregistrées.",
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `Options: groupe **${sub.group}**\nMention via rôle: **${
        sub.mention ? "oui" : "non"
      }**\nMP: **${wantsDM(sub) ? "oui" : "non"}**`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "simulate") {
    const groupName = interaction.options.getString("group");
    const changeType =
      interaction.options.getString("change_type") || "simulate";
    const sendTo = interaction.options.getString("send_to") || "me";
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (err) {
      console.error("Failed to defer interaction reply for /simulate:", err);
    }

    const group = groups.find((g) => g.nom === groupName);
    if (!group) {
      try {
        await interaction.editReply({
          content: `Groupe inconnu. Groupes disponibles : ${groups
            .map((g) => g.nom)
            .join(", ")}`,
        });
      } catch (e) {}
      return;
    }

    try {
      const url = group.urls && group.urls.length > 0 ? group.urls[0] : null;
      if (!url) {
        try {
          await interaction.editReply({
            content: "Aucune URL iCal configurée pour ce groupe.",
          });
        } catch (e) {}
        return;
      }
      const key = `${group.nom}::${url}`;
      const events = await fetchEvents([url]);
      if (!events || events.length === 0) {
        try {
          await interaction.editReply({
            content: "Aucun événement trouvé pour ce groupe.",
          });
        } catch (e) {}
        return;
      }

      // Take first event for simulation
      const ev = events[0];
      // Build embed according to requested changeType
      let embed;
      if (changeType === "added" || changeType === "simulate") {
        embed = buildChangeEmbed("added", null, ev, ev.group || group.nom);
      } else if (changeType === "removed") {
        embed = buildChangeEmbed("removed", ev, null, ev.group || group.nom);
      } else if (changeType === "modified") {
        const newStart = shiftDateStrByHours(ev.start, 1);
        const newEnd = shiftDateStrByHours(ev.end, 1);
        const newEvt = Object.assign({}, ev, { start: newStart, end: newEnd });
        embed = buildChangeEmbed(
          "modified",
          ev,
          newEvt,
          newEvt.group || ev.group || group.nom
        );
      } else if (changeType === "location") {
        const oldEvt = Object.assign({}, ev);
        const newLoc =
          ev.location && ev.location.length > 0
            ? ev.location
            : "Salle inconnue";
        const newEvt = Object.assign({}, ev, { location: newLoc });
        embed = buildChangeEmbed(
          "location",
          oldEvt,
          newEvt,
          newEvt.group || oldEvt.group || group.nom
        );
      } else {
        embed = buildChangeEmbed("simulate", null, ev, ev.group || group.nom);
      }

      const roleName = require("./roles").roleNameFromGroupNom(group.nom);
      const mappedChannelId = ROLE_CHANNEL_MAP[roleName];

      // Always attempt to send to mapped channel first
      let posted = false;
      if (mappedChannelId) {
        try {
          const channel = await client.channels
            .fetch(mappedChannelId)
            .catch(() => null);
          if (channel && channel.isTextBased && channel.isTextBased()) {
            const guild = channel.guild;
            const role = guild.roles.cache.find((r) => r.name === roleName);
            if (role) {
              await sendEmbedToChannels([channel], embed, role);
              posted = true;
            }
          }
        } catch (err) {
          console.error("Erreur lors de l'envoi du message simulé:", err);
        }
      }
      // If not posted to mapped channel, send to user
      if (!posted && sendTo === "me") {
        await sendEmbedDMs([interaction.user], embed);
      }
      await interaction.editReply({
        content: "Simulation envoyée.",
        ephemeral: true,
      });
    } catch (err) {
      console.error("Erreur dans /simulate:", err);
      try {
        await interaction.editReply({
          content: "Erreur lors de la simulation.",
        });
      } catch (e) {}
    }
  }
}

module.exports = {
  getGlobalCommands,
  getTestGuildCommands,
  registerCommands,
  handleSlashCommand,
};
