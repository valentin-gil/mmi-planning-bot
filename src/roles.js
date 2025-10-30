const groups = require("../groups");

function roleNameFromGroupNom(nom) {
  const yearMatch = nom.match(/(\d+)/);
  const tpMatch = nom.match(/TP\s*(\d+)/i) || nom.match(/TP(\d+)/i);
  const nums = nom.match(/(\d+)/g) || [];
  const year = yearMatch ? yearMatch[1] : nums[0] || "0";
  const groupNum = tpMatch ? tpMatch[1] : nums[1] || nums[0] || "0";
  return `*CC${year}:${groupNum}`;
}

function normalizeForMatch(s) {
  if (!s) return "";
  const noAccent = s.normalize
    ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    : s;
  return noAccent
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findUserGroupFromRoles(member) {
  if (!member || !member.roles) return null;
  const roleNames = member.roles.cache.map((r) => normalizeForMatch(r.name));
  for (const group of groups) {
    const gNorm = normalizeForMatch(group.nom);
    if (roleNames.some((rn) => rn.includes(gNorm) || gNorm.includes(rn))) {
      return group;
    }
  }
  return null;
}

async function ensureRolesInGuild(guild) {
  for (const group of groups) {
    const roleName = roleNameFromGroupNom(group.nom);
    let role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      try {
        role = await guild.roles.create({
          name: roleName,
          color: "#36393F",
          mentionable: true,
        });
        console.log(`Created role ${roleName} in guild ${guild.id}`);
      } catch (err) {
        console.error(
          `Failed to create role ${roleName} in guild ${guild.id}:`,
          err
        );
      }
    }
  }
}

module.exports = {
  roleNameFromGroupNom,
  normalizeForMatch,
  findUserGroupFromRoles,
  ensureRolesInGuild,
};
