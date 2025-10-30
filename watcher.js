const {
  Client,
  GatewayIntentBits,
  ApplicationCommandOptionType,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const express = require("express");
const app = express();
const fetch = (...args) =>
  import("node-fetch").then((mod) => mod.default(...args));
const ICAL = require("ical.js");
const groups = require("./groups.js");
const {
  DISCORD_TOKEN,
  DEV_GUILD_ID,
  ROLES_CHANNEL_ID,
  PORT,
  ROLE_CHANNEL_MAP,
} = require("./src/config");
const { registerCommands } = require("./src/commands");
const {
  roleNameFromGroupNom,
  normalizeForMatch,
  findUserGroupFromRoles,
  ensureRolesInGuild,
} = require("./src/roles");
const {
  buildChangeEmbed,
  toEpochSeconds,
  discordTsRange,
  shiftDateStrByHours,
  sendEmbedToChannels,
  sendEmbedDMs,
} = require("./src/notifications");
app.get("/", (req, res) => res.send("OK"));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));
const fs = require("fs");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ["CHANNEL"],
});

client.on("guildCreate", async (guild) => {
  try {
    await ensureRolesInGuild(guild);
  } catch (err) {
    console.error(`Error ensuring roles in new guild ${guild.id}:`, err);
  }
});

let subscriptions = {};
const SUB_FILE = "./subscriptions.json";

if (fs.existsSync(SUB_FILE)) {
  subscriptions = JSON.parse(fs.readFileSync(SUB_FILE));
}
for (const userId in subscriptions) {
  if (typeof subscriptions[userId] === "string") {
    subscriptions[userId] = {
      group: subscriptions[userId],
      mention: false,
      dm: true,
    };
  }
}

let lastEventsByGroup = {};

async function fetchEvents(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(
            `Erreur HTTP pour ${url}: ${res.status} ${res.statusText}`
          );
          return null;
        }
        const text = await res.text();
        if (!text.trim().startsWith("BEGIN:VCALENDAR")) {
          console.error(
            `Réponse non-ical pour ${url}: commence par "${text
              .trim()
              .slice(0, 40)}..."`
          );
          return null;
        }
        return text;
      } catch (err) {
        console.error(`Erreur lors du fetch de ${url}:`, err);
        return null;
      }
    })
  );
  return results.filter(Boolean).flatMap((text) => {
    let jcalData;
    try {
      jcalData = ICAL.parse(text);
    } catch (err) {
      console.error("Erreur de parsing iCal:", err);
      return [];
    }
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");
    return vevents.map((evt) => {
      const e = new ICAL.Event(evt);
      const startStr = e.startDate.toString();
      const endStr = e.endDate.toString();
      const description =
        e.component.getFirstPropertyValue("description") || "";
      const organizer = e.component.getFirstPropertyValue("organizer") || "";
      let lastModifiedRaw = e.component.getFirstPropertyValue("last-modified");
      let lastModifiedEpoch = null;
      let isRecentlyModified = false;
      if (lastModifiedRaw) {
        let d;
        if (typeof lastModifiedRaw.toJSDate === "function") {
          d = lastModifiedRaw.toJSDate();
        } else {
          d = new Date(lastModifiedRaw);
        }
        if (!isNaN(d)) {
          lastModifiedEpoch = Math.floor(d.getTime() / 1000);
          const now = new Date();
          const nowUTC = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
          );
          const modUTC = new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
          );
          isRecentlyModified = nowUTC.getTime() === modUTC.getTime();
        }
      }

      let updatedEpoch = null;
      const updMatch = String(description).match(
        /Updated\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{1,2}:\d{2})/i
      );
      if (updMatch) {
        try {
          const datePart = updMatch[1];
          const timePart = updMatch[2];
          const [dd, mm, yyyy] = datePart
            .split("/")
            .map((s) => parseInt(s, 10));
          const [hh, min] = timePart.split(":").map((s) => parseInt(s, 10));
          const dt = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min));
          updatedEpoch = Math.floor(dt.getTime() / 1000);
        } catch (e) {
          updatedEpoch = null;
        }
      }

      const textBlob = `${e.summary || ""} ${description || ""} ${
        e.component.getFirstPropertyValue("location") || ""
      }`.toLowerCase();
      let inferredGroup = "";
      for (const g of groups) {
        if (!g || !g.nom) continue;
        const nomLow = String(g.nom).toLowerCase();
        if (
          textBlob.includes(nomLow) ||
          (e.summary && String(e.summary).toLowerCase().includes(nomLow))
        ) {
          inferredGroup = g.nom;
          break;
        }
      }

      let teacher = "";
      let descGroup = "";
      if (description) {
        const parts = String(description).split(/\r?\n\r?\n/);
        let afterDouble = parts.length > 1 ? parts[1] : parts[0];
        const sectionLines = afterDouble
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (sectionLines.length >= 1) {
          descGroup = sectionLines[0];
        }
        if (sectionLines.length >= 2) {
          teacher = sectionLines[1];
        } else {
          const md = String(description).match(
            /(?:Enseignant|Prof|Professeur|Teacher)[:\-]\s*([^\n\r]+)/i
          );
          if (md) teacher = md[1].trim();
        }
      }
      if (organizer) {
        const o = String(organizer);
        const m = o.match(/CN=([^;:@]+)/i);
        if (m) teacher = m[1];
        else {
          const m2 = o.match(/mailto:([^@]+)/i);
          if (m2) teacher = m2[1];
          else if (!teacher) teacher = o;
        }
      }

      return {
        uid: e.component.getFirstPropertyValue("uid") || "",
        summary: e.summary,
        start: startStr,
        end: endStr,
        startEpoch: toEpochSeconds(startStr),
        endEpoch: toEpochSeconds(endStr),
        location: e.component.getFirstPropertyValue("location") || "",
        description,
        organizer,
        teacher: teacher || "—",
        group: descGroup || inferredGroup || "",
        updatedEpoch,
        lastModifiedRaw,
        lastModifiedEpoch,
        isRecentlyModified,
      };
    });
  });
}

function diffEvents(oldEvents, newEvents) {
  const oldSet = new Set(oldEvents.map((e) => e.summary + e.start + e.end));
  return newEvents.filter((e) => !oldSet.has(e.summary + e.start + e.end));
}

function compareEvents(oldEvents, newEvents) {
  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase();
  }
  function eventKey(e) {
    if (e.uid && String(e.uid).trim().length > 0) return String(e.uid).trim();
    return norm(e.summary) + ":" + norm(e.start) + ":" + norm(e.end);
  }
  const oldMap = new Map();
  oldEvents.forEach((e) => {
    oldMap.set(eventKey(e), e);
  });
  const newMap = new Map();
  newEvents.forEach((e) => {
    newMap.set(eventKey(e), e);
  });

  const added = [];
  const removed = [];
  const modified = [];
  const locationChanged = [];

  for (const [key, ne] of newMap.entries()) {
    if (!oldMap.has(key)) {
      added.push(ne);
    } else {
      const oe = oldMap.get(key);
      if (oe.start !== ne.start || oe.end !== ne.end) {
        modified.push({ old: oe, new: ne });
      } else if ((oe.location || "") !== (ne.location || "")) {
        locationChanged.push({ old: oe, new: ne });
      }
    }
  }

  function isFutureOrToday(evt) {
    if (!evt || !evt.endEpoch) return false;
    const now = new Date();
    const todayUTC =
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) /
      1000;
    return evt.endEpoch >= todayUTC;
  }
  for (const [key, oe] of oldMap.entries()) {
    if (!newMap.has(key)) {
      if (isFutureOrToday(oe)) {
        removed.push(oe);
      }
    }
  }

  return { added, removed, modified, locationChanged };
}

function wantsDM(sub) {
  if (!sub) return true;
  if (typeof sub.dm === "undefined") return true;
  return Boolean(sub.dm);
}

async function checkForChanges() {
  for (const group of groups) {
    for (const url of group.urls) {
      const key = `${group.nom}::${url}`;
      try {
        const events = await fetchEvents([url]);
        if (!events || events.length === 0) {
          console.warn(`[ICS] Planning inaccessible ou vide pour ${group.nom} (${url}) : aucune comparaison, aucun message envoyé.`);
          continue;
        }
        const lastEvents = lastEventsByGroup[key] || [];
        const { added, removed, modified, locationChanged } = compareEvents(
          lastEvents,
          events
        );
        const anyChanges =
          added.length +
          removed.length +
          modified.length +
          locationChanged.length;
        if (anyChanges > 0) {
          const roleName = roleNameFromGroupNom(group.nom);

          const sendChange = async (changeType, oldEvt, newEvt) => {
            const sourceEvt = newEvt || oldEvt;
            const grpName =
              sourceEvt && sourceEvt.group ? sourceEvt.group : group.nom;
            const embed = buildChangeEmbed(
              changeType === "location"
                ? "location"
                : changeType === "modified"
                ? "modified"
                : changeType === "removed"
                ? "removed"
                : "added",
              oldEvt,
              newEvt,
              grpName,
              group.nom
            );
            await sendEmbedDMs(
              client,
              embed,
              Object.keys(subscriptions),
              subscriptions,
              group.nom,
              wantsDM
            );
            await sendEmbedToChannels(
              client,
              embed,
              roleName,
              ROLE_CHANNEL_MAP
            );
          };

          for (const ev of added) {
            await sendChange("added", null, ev);
          }
          for (const ev of removed) {
            await sendChange("removed", ev, null);
          }
          for (const pair of modified) {
            await sendChange("modified", pair.old, pair.new);
          }
          for (const pair of locationChanged) {
            await sendChange("location", pair.old, pair.new);
          }

          lastEventsByGroup[key] = events;
        }
      } catch (err) {
        console.error(`Erreur pour le groupe ${group.nom} (${url}):`, err);
      }
    }
  }
}

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton && interaction.isButton()) {
    const id = interaction.customId;
    if (!interaction.guild)
      return interaction.reply({
        content: "Cette action doit être effectuée depuis un serveur.",
        ephemeral: true,
      });
    const member = interaction.member;
    if (!member)
      return interaction.reply({
        content: "Impossible de récupérer le membre.",
        ephemeral: true,
      });

    if (id === "roles_toggle_mention") {
      const db = require("./src/db");
      const group = findUserGroupFromRoles(member);
      if (!group)
        return interaction.reply({
          content:
            "Impossible de déterminer ton groupe depuis tes rôles. Assure-toi d'avoir un rôle correspondant (ex: '2eme année - TP4').",
          ephemeral: true,
        });
      try {
        await ensureRolesInGuild(interaction.guild);
        const roleName = roleNameFromGroupNom(group.nom);
        const role = interaction.guild.roles.cache.find(
          (r) => r.name === roleName
        );
        if (!role)
          return interaction.reply({
            content: `Le rôle ${roleName} est introuvable et n'a pas pu être créé. Vérifie les permissions du bot.`,
            ephemeral: true,
          });
        const has = member.roles.cache.has(role.id);
        if (has) {
          await member.roles.remove(role);
        } else {
          await member.roles.add(role);
        }
        const userId = member.id;
        const sub = await db.getSubscription(userId);
        await db.saveSubscription(userId, group.nom, !has, sub ? sub.dm : true);
        return interaction.reply({
          content: has
            ? `Tu ne seras plus mentionné lors des changements d'emploi du temps.`
            : `Tu seras désormais mentionné lors des changements d'emploi du temps.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error("Erreur lors du toggle mention:", err);
        return interaction.reply({
          content: "Erreur lors de la modification de ton rôle (voir logs).",
          ephemeral: true,
        });
      }
    }

    if (id === "roles_toggle_dm") {
      const db = require("./src/db");
      const group = findUserGroupFromRoles(member);
      if (!group)
        return interaction.reply({
          content:
            "Impossible de déterminer ton groupe depuis tes rôles. Assure-toi d'avoir un rôle correspondant (ex: '2eme année - TP4').",
          ephemeral: true,
        });
      try {
        const userId = member.id;
        const sub = await db.getSubscription(userId);
        await db.saveSubscription(userId, group.nom, sub ? sub.mention : false, sub ? !sub.dm : true);
        return interaction.reply({
          content: sub && !sub.dm
            ? "Tu recevras désormais des MP lors des changements d'emploi du temps."
            : "Tu ne recevras plus de MP lors des changements d'emploi du temps.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("Erreur lors du toggle DM:", err);
        return interaction.reply({
          content:
            "Erreur lors de la modification de ta préférence DM (voir logs).",
          ephemeral: true,
        });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

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
      content: `Groupe : **${sub.group}**\nMention : **${
        sub.mention ? "oui" : "non"
      }**\nMP : **${wantsDM(sub) ? "oui" : "non"}**`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "simulate") {
    const groupName = interaction.options.getString("group");
    const changeType =
      interaction.options.getString("change_type") || "simulate";
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

      const ev = events[0];
      let embed;
      if (changeType === "added" || changeType === "simulate") {
        embed = buildChangeEmbed(
          "added",
          null,
          ev,
          ev.group || group.nom,
          group.nom
        );
      } else if (changeType === "removed") {
        embed = buildChangeEmbed(
          "removed",
          ev,
          null,
          ev.group || group.nom,
          group.nom
        );
      } else if (changeType === "modified") {
        const newStart = shiftDateStrByHours(ev.start, 1);
        const newEnd = shiftDateStrByHours(ev.end, 1);
        const newEvt = Object.assign({}, ev, { start: newStart, end: newEnd });
        embed = buildChangeEmbed(
          "modified",
          ev,
          newEvt,
          newEvt.group || ev.group || group.nom,
          group.nom
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
          newEvt.group || oldEvt.group || group.nom,
          group.nom
        );
      } else {
        embed = buildChangeEmbed(
          "simulate",
          null,
          ev,
          ev.group || group.nom,
          group.nom
        );
      }

      const roleName = roleNameFromGroupNom(group.nom);
      const mappedChannelId = ROLE_CHANNEL_MAP[roleName];

      let posted = false;
      if (mappedChannelId) {
        try {
          const channel = await client.channels
            .fetch(mappedChannelId)
            .catch(() => null);
          if (channel && channel.isTextBased && channel.isTextBased()) {
            const guild = channel.guild;
            const role = guild.roles.cache.find((r) => r.name === roleName);
            const mentionStr = role ? role.toString() : roleName;
            await channel.send({ content: mentionStr, embeds: [embed] });
            posted = true;
          }
        } catch (err) {
          console.error(
            `Erreur en postant la simulation dans le channel mappé ${mappedChannelId}:`,
            err
          );
        }
      }

      if (!posted) {
        for (const guild of client.guilds.cache.values()) {
          try {
            const role = guild.roles.cache.find((r) => r.name === roleName);
            if (!role || role.members.size === 0) continue;
            const targetChannel =
              guild.systemChannel ??
              guild.channels.cache.find(
                (ch) =>
                  ch.type === ChannelType.GuildText &&
                  ch
                    .permissionsFor(guild.members.me)
                    .has(PermissionsBitField.Flags.SendMessages)
              );
            if (!targetChannel) continue;
            await targetChannel.send({
              content: role.toString(),
              embeds: [embed],
            });
            posted = true;
          } catch (err) {
            console.error(
              `Erreur en postant l'annonce pour le rôle ${roleName} dans la guilde ${guild.id}:`,
              err
            );
          }
        }
      }

      await sendEmbedDMs(
        client,
        embed,
        Object.keys(subscriptions),
        subscriptions,
        group.nom,
        wantsDM
      );

      try {
        await interaction.editReply({
          content: "Simulation envoyée.",
          ephemeral: true,
        });
      } catch (e) {}
      return;
    } catch (err) {
      console.error("Erreur lors de la simulation :", err);
      try {
        await interaction.editReply({
          content: "Erreur lors de la simulation (voir console).",
          ephemeral: true,
        });
      } catch (e) {}
      return;
    }
  }
});

client.once("clientReady", async () => {
  console.log("Ready");
  try {
    if (client.user) {
      await client.user.setPresence({
        activities: [
          { name: "mmi-planning.vgil.fr", type: ActivityType.Watching },
        ],
        status: "online",
      });
    }
  } catch (err) {
    console.error("Impossible de définir la présence:", err);
  }

  client.on("error", (err) => {
    console.error("Discord client error:", err);
  });

  process.on("unhandledRejection", (reason, p) => {
    console.error("Unhandled Rejection at:", p, "reason:", reason);
  });

  try {
    await registerCommands(client);
  } catch (err) {
    console.error("Erreur en enregistrant les commandes slash :", err);
  }

  try {
    await Promise.all(client.guilds.cache.map((g) => ensureRolesInGuild(g)));
    console.log(
      "Vérification/creation des rôles effectuée pour tous les serveurs."
    );
  } catch (err) {
    console.error(
      "Erreur lors de l'initialisation des rôles dans les serveurs :",
      err
    );
  }
  try {
    const channel = await client.channels
      .fetch(ROLES_CHANNEL_ID)
      .catch(() => null);
    if (channel && channel.isTextBased && channel.isTextBased()) {
      const fetched = await channel.messages.fetch({ limit: 50 });
      const marker = "ci-dessous pour activer";
      let existing = fetched.find((m) => {
        if (!m.author || m.author.id !== client.user.id) return false;
        if (m.content && m.content.includes(marker)) return true;
        if (m.embeds && m.embeds.length) {
          return m.embeds.some(
            (e) =>
              (e.description &&
                e.description.text &&
                e.description.text.includes(marker)) ||
              (e.footer && e.footer.text.includes(marker))
          );
        }
        return false;
      });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("roles_toggle_mention")
          .setLabel("Mention")
          .setEmoji("<:bell:1433107833766805705>")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("roles_toggle_dm")
          .setLabel("Message privé")
          .setEmoji("<:mail:1433107822479937641>")
          .setStyle(ButtonStyle.Secondary)
      );
      const embed = new EmbedBuilder()
        .setColor(0x26a1fd)
        .setTitle("Préférences de notification")
        .setDescription(
          `**Ne manque plus aucun changement de cours !**\n\n` +
            `Toutes les modifications de l'emploi du temps sont détectées et envoyées dans le salon #changement-cours.\n\n` +
            `Tu peux consulter ton emploi du temps à tout moment sur : [mmi-planning.vgil.fr](https://mmi-planning.vgil.fr)\n\n` +
            `Pour être sûr de ne rien manquer, tu peux activer une ou plusieurs des options ci-dessous :`
        )
        .addFields(
          {
            name: "<:bell:1433107833766805705> Mention",
            value: "Tu seras notifié dans le salon #changement-cours à chaque fois qu'un changement sera détecté dans l'emploi du temps",
            inline: true,
          },
          {
            name: "<:mail:1433107822479937641> Message privé",
            value: "Tu recevras un message privé à chaque fois qu'un changement sera détecté dans l'emploi du temps",
            inline: true,
          }
        );
        embed.setFooter({ text: 'Utilise les boutons ci-dessous pour activer ou désactiver chaque option.' });

      if (!existing) {
        await channel.send({ embeds: [embed], components: [row] });
      }
    }
  } catch (err) {
    console.error("Erreur en s'occupant du message de role preferences:", err);
  }

  groups.forEach(async (group) => {
    for (const url of group.urls) {
      const key = `${group.nom}::${url}`;
      lastEventsByGroup[key] = await fetchEvents([url]);
    }
  });
  setInterval(checkForChanges, 5 * 60 * 1000);
});

client.login(DISCORD_TOKEN);
