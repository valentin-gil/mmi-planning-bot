require('dotenv').config();

function getUrlsFromEnv(groupKey) {
  const envVar = process.env[`GROUP_${groupKey}_URLS`];
  if (!envVar) return [];
  return envVar.split(',').map(u => u.trim()).filter(Boolean);
}

module.exports = [
  { nom: "1ère année TP1", urls: getUrlsFromEnv("1A_TP1") },
  { nom: "1ère année TP2", urls: getUrlsFromEnv("1A_TP2") },
  { nom: "1ère année TP3", urls: getUrlsFromEnv("1A_TP3") },
  { nom: "1ère année TP4", urls: getUrlsFromEnv("1A_TP4") },
  { nom: "2ème année TP1", urls: getUrlsFromEnv("2A_TP1") },
  { nom: "2ème année TP2", urls: getUrlsFromEnv("2A_TP2") },
  { nom: "2ème année TP3", urls: getUrlsFromEnv("2A_TP3") },
  { nom: "2ème année TP4", urls: getUrlsFromEnv("2A_TP4") },
  { nom: "3ème année TP1", urls: getUrlsFromEnv("3A_TP1") },
  { nom: "3ème année TP2", urls: getUrlsFromEnv("3A_TP2") },
  { nom: "3ème année TP3", urls: getUrlsFromEnv("3A_TP3") },
  { nom: "3ème année TP4", urls: getUrlsFromEnv("3A_TP4") },
];