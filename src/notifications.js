const {
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

function toEpochSeconds(dateStr) {
  if (!dateStr) return Math.floor(Date.now() / 1000);
  const d1 = Date.parse(dateStr);
  if (!isNaN(d1)) return Math.floor(d1 / 1000);
  const m = String(dateStr).match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/
  );
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);
    const second = parseInt(m[6], 10);
    if (m[7] === "Z") {
      return Math.floor(
        Date.UTC(year, month, day, hour, minute, second) / 1000
      );
    }
    return Math.floor(
      new Date(year, month, day, hour, minute, second).getTime() / 1000
    );
  }
  return Math.floor(Date.now() / 1000);
}

function discordTsRange(startStr, endStr) {
  const s = toEpochSeconds(startStr);
  const e = toEpochSeconds(endStr);
  return `<t:${s}:f> → <t:${e}:f>`;
}

function shiftDateStrByHours(dateStr, hours) {
  const seconds = toEpochSeconds(dateStr);
  const shifted = new Date((seconds + hours * 3600) * 1000);
  return shifted.toISOString();
}

function buildChangeEmbed(type, oldEvt, newEvt, groupName, groupUrl) {
  const embed = new EmbedBuilder();
  const colorMap = {
    added: 0x2ecc71,
    removed: 0xe74c3c,
    modified: 0xf39c12,
    location: 0x3498db,
    simulate: 0x3498db,
  };
  embed.setColor(colorMap[type] || 0x95a5a6);
  function displayGroupField(g) {
    if (typeof g === "string" && (g.startsWith("T") || g.startsWith("C")))
      return g;
    return "—";
  }
  function extractTeacher(evt) {
    if (!evt) return "—";
    if (
      evt.teacher &&
      String(evt.teacher).trim().length > 0 &&
      evt.teacher !== "—"
    )
      return evt.teacher;
    if (evt.organizer) {
      const o = String(evt.organizer);
      const m = o.match(/CN=([^;:@]+)/i);
      if (m) return m[1];
      const m2 = o.match(/mailto:([^@]+)/i);
      if (m2) return m2[1];
    }
    if (evt.description) {
      const d = String(evt.description);
      const md = d.match(
        /(?:Enseignant|Prof|Professeur|Teacher)[:\-]\s*([^\n\r]+)/i
      );
      if (md) return md[1].trim();
    }
    return "—";
  }

  const formatDate = (dateStr) => {
    const s = toEpochSeconds(dateStr);
    return `<t:${s}:d>`;
  };
  const formatTime = (dateStr) => {
    const s = toEpochSeconds(dateStr);
    return `<t:${s}:t>`;
  };

  const normalizeEmpty = (v) => {
    if (!v) return "";
    const s = String(v).trim();
    return s === "—" ? "" : s;
  };
  const sideBySideText = (oldVal, newVal) => {
    const o = normalizeEmpty(oldVal);
    const n = normalizeEmpty(newVal);
    if (!o && !n) return "—";
    if (!o && n) return `${n}`;
    if (o !== n) return `~~${o}~~ ${n || "—"}`;
    return n || o || "—";
  };
  const sideBySideDate = (oldDateStr, newDateStr) => {
    if (!newDateStr && !oldDateStr) return "—";
    if (!newDateStr) return formatDate(oldDateStr);
    try {
      const oSec = toEpochSeconds(oldDateStr);
      const nSec = toEpochSeconds(newDateStr);
      const od = new Date(oSec * 1000);
      const nd = new Date(nSec * 1000);
      if (
        oldDateStr &&
        od.getFullYear() === nd.getFullYear() &&
        od.getMonth() === nd.getMonth() &&
        od.getDate() === nd.getDate()
      ) {
        return `${formatDate(newDateStr)}`;
      }
      if (oSec && nSec && oSec !== nSec)
        return `~~${formatDate(oldDateStr)}~~ ${formatDate(newDateStr)}`;
    } catch (e) {}
    if (!oldDateStr && newDateStr) return `${formatDate(newDateStr)}`;
    return formatDate(newDateStr || oldDateStr);
  };
  const sideBySideTime = (oldDateStr, newDateStr) => {
    const oSec = toEpochSeconds(oldDateStr);
    const nSec = toEpochSeconds(newDateStr);
    if (!oldDateStr && newDateStr) return `${formatTime(newDateStr)}`;
    if (oSec && nSec && oSec !== nSec)
      return `~~${formatTime(oldDateStr)}~~ ${formatTime(newDateStr)}`;
    return formatTime(newDateStr || oldDateStr);
  };

  function getGroupParam(nom) {
    const yearMatch = nom.match(/(\d+)/);
    const tpMatch = nom.match(/TP\s*(\d+)/i) || nom.match(/TP(\d+)/i);
    const nums = nom.match(/(\d+)/g) || [];
    const year = yearMatch ? yearMatch[1] : nums[0] || "0";
    const groupNum = tpMatch ? tpMatch[1] : nums[1] || nums[0] || "0";
    return `${year}:${groupNum}`;
  }
  function getWeekParam(evt) {
    if (!evt || !evt.start) return "";
    const d = new Date(evt.start);
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const dayOfYear = (d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1;
    const week = Math.ceil((dayOfYear + jan4.getDay() - 1) / 7);
    return week;
  }
  function getClassParam(evt) {
    return evt && evt.uid ? encodeURIComponent(evt.uid) : "";
  }
  function emploiDuTempsUrl(evt, groupNom) {
    const group = getGroupParam(groupNom);
    const week = getWeekParam(evt);
    const uid = getClassParam(evt);
    return `https://mmi-planning.vgil.fr/?group=${group}&week=${week}&class=${uid}`;
  }

  if (type === "added" || type === "simulate") {
    embed.setTitle(`Nouveau cours : ${newEvt.summary}`);
    embed.setDescription(
      `[Voir dans l'emploi du temps](${emploiDuTempsUrl(newEvt, groupUrl)})`
    );
    embed.addFields(
      {
        name: "<:userRound:1432504006470799360> Enseignant",
        value: extractTeacher(newEvt) || "—",
        inline: false,
      },
      {
        name: "<:doorOpen:1432504022807613551> Salle de cours",
        value: (newEvt && newEvt.location) || "—",
        inline: true,
      },
      {
        name: "<:usersRound:1432504014561349653> Groupe",
        value: displayGroupField((newEvt && newEvt.group) || groupName || "—"),
        inline: true,
      }
    );
    embed.addFields(
      {
        name: "<:calendar:1432503974338236567> Date du cours",
        value: formatDate(newEvt && newEvt.start),
        inline: false,
      },
      {
        name: "<:clock2:1432503990385381479> Début du cours",
        value: formatTime(newEvt && newEvt.start),
        inline: true,
      },
      {
        name: "<:clock8:1432503999461855282> Fin du cours",
        value: formatTime(newEvt && newEvt.end),
        inline: true,
      }
    );
    embed.setFooter({ text: "Ajouté le" });
  } else if (type === "removed") {
    embed.setTitle(`Cours supprimé : ${oldEvt.summary}`);
    embed.setDescription(
      `[Voir dans l'emploi du temps](${emploiDuTempsUrl(oldEvt, groupUrl)})`
    );
    embed.addFields(
      {
        name: "<:userRound:1432504006470799360> Enseignant",
        value: extractTeacher(oldEvt) || "—",
        inline: false,
      },
      {
        name: "<:doorOpen:1432504022807613551> Salle de cours",
        value: (oldEvt && oldEvt.location) || "—",
        inline: true,
      },
      {
        name: "<:usersRound:1432504014561349653> Groupe",
        value: displayGroupField((oldEvt && oldEvt.group) || groupName || "—"),
        inline: true,
      }
    );
    embed.addFields(
      {
        name: "<:calendar:1432503974338236567> Date du cours",
        value: formatDate(oldEvt && oldEvt.start),
        inline: false,
      },
      {
        name: "<:clock2:1432503990385381479> Début du cours",
        value: formatTime(oldEvt && oldEvt.start),
        inline: true,
      },
      {
        name: "<:clock8:1432503999461855282> Fin du cours",
        value: formatTime(oldEvt && oldEvt.end),
        inline: true,
      }
    );
    embed.setFooter({ text: "Supprimé le" });
  } else if (type === "modified") {
    embed.setTitle(`Cours modifié : ${newEvt.summary}`);
    embed.setDescription(
      `[Voir dans l'emploi du temps](${emploiDuTempsUrl(newEvt, groupUrl)})`
    );
    const salleField = sideBySideText(
      oldEvt && oldEvt.location,
      newEvt && newEvt.location
    );
    const enseignantField = sideBySideText(
      extractTeacher(oldEvt),
      extractTeacher(newEvt)
    );
    const oldGroupVal = oldEvt && oldEvt.group ? oldEvt.group : "";
    const newGroupVal = newEvt && newEvt.group ? newEvt.group : groupName || "";
    let groupeField;
    if (
      (typeof oldGroupVal === "string" &&
        (oldGroupVal.startsWith("T") || oldGroupVal.startsWith("C"))) ||
      (typeof newGroupVal === "string" &&
        (newGroupVal.startsWith("T") || newGroupVal.startsWith("C")))
    ) {
      groupeField = sideBySideText(oldGroupVal, newGroupVal);
    } else {
      groupeField = "—";
    }
    embed.addFields(
      {
        name: "<:userRound:1432504006470799360> Enseignant",
        value: enseignantField,
        inline: false,
      },
      {
        name: "<:doorOpen:1432504022807613551> Salle de cours",
        value: salleField,
        inline: true,
      },
      {
        name: "<:usersRound:1432504014561349653> Groupe",
        value: groupeField,
        inline: true,
      }
    );
    embed.addFields(
      {
        name: "<:calendar:1432503974338236567> Date du cours",
        value: sideBySideDate(oldEvt && oldEvt.start, newEvt && newEvt.start),
        inline: false,
      },
      {
        name: "<:clock2:1432503990385381479> Début du cours",
        value: sideBySideTime(oldEvt && oldEvt.start, newEvt && newEvt.start),
        inline: true,
      },
      {
        name: "<:clock8:1432503999461855282> Fin du cours",
        value: sideBySideTime(oldEvt && oldEvt.end, newEvt && newEvt.end),
        inline: true,
      }
    );
    embed.setFooter({ text: "Modifié le" });
  } else if (type === "location") {
    embed.setTitle(`Changement de salle : ${newEvt.summary}`);
    embed.setDescription(
      `[Voir dans l'emploi du temps](${emploiDuTempsUrl(newEvt, groupUrl)})`
    );
    embed.addFields(
      {
        name: "<:userRound:1432504006470799360> Enseignant",
        value: extractTeacher(newEvt) || "—",
        inline: false,
      },
      {
        name: "<:doorOpen:1432504022807613551> Salle de cours",
        value: sideBySideText(
          oldEvt && oldEvt.location,
          newEvt && newEvt.location
        ),
        inline: true,
      },
      {
        name: "<:usersRound:1432504014561349653> Groupe",
        value: displayGroupField((newEvt && newEvt.group) || groupName || ""),
        inline: true,
      }
    );
    embed.addFields(
      {
        name: "<:calendar:1432503974338236567> Date du cours",
        value: formatDate(newEvt && newEvt.start),
        inline: false,
      },
      {
        name: "<:clock2:1432503990385381479> Début du cours",
        value: formatTime(newEvt && newEvt.start),
        inline: true,
      },
      {
        name: "<:clock8:1432503999461855282> Fin du cours",
        value: formatTime(newEvt && newEvt.end),
        inline: true,
      }
    );
    embed.setFooter({ text: "Modifié le" });
  }
  const lastMod =
    newEvt && newEvt.lastModifiedEpoch
      ? newEvt.lastModifiedEpoch
      : oldEvt && oldEvt.lastModifiedEpoch
      ? oldEvt.lastModifiedEpoch
      : null;
  const explicitUpd =
    newEvt && newEvt.updatedEpoch
      ? newEvt.updatedEpoch
      : oldEvt && oldEvt.updatedEpoch
      ? oldEvt.updatedEpoch
      : null;
  if (lastMod) {
    embed.setTimestamp(new Date(lastMod * 1000));
  } else if (explicitUpd) {
    embed.setTimestamp(new Date(explicitUpd * 1000));
  } else {
    embed.setTimestamp(new Date());
  }
  return embed;
}

async function sendEmbedToChannels(client, embed, roleName, ROLE_CHANNEL_MAP) {
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
        `Erreur en postant dans le channel mappé ${mappedChannelId}:`,
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
        await targetChannel.send({ content: role.toString(), embeds: [embed] });
        posted = true;
      } catch (err) {
        console.error(
          `Erreur en postant l'annonce pour le rôle ${roleName} dans la guilde ${guild.id}:`,
          err
        );
      }
    }
  }
  return posted;
}

const db = require("./db");
async function sendEmbedDMs(
  client,
  embed,
  userIds,
  _subscriptions,
  groupName,
  _wantsDM
) {
  const { normalizeForMatch } = require("./roles");
  for (const userId of userIds) {
    try {
      const sub = await db.getSubscription(userId);
      const normSubGroup = sub ? normalizeForMatch(sub.group_name) : null;
      const normGroupName = normalizeForMatch(groupName);
      if (sub && normSubGroup === normGroupName && sub.dm) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          await user
            .send({ embeds: [embed] })
            .catch((err) =>
              console.error(`Impossible d'envoyer le DM à ${userId}:`, err)
            );
        }
      }
    } catch (err) {
      console.error(`Erreur lors de l'envoi du DM à ${userId}:`, err);
    }
  }
}

module.exports = {
  buildChangeEmbed,
  toEpochSeconds,
  discordTsRange,
  shiftDateStrByHours,
  sendEmbedToChannels,
  sendEmbedDMs,
};
