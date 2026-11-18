const NO_HISTORY = "لا توجد مجموعات مرتبطة برصيدك بعد. اكتب /mypoints في المجموعة التي لعبت فيها، ثم أعد الطلب هنا.";
const UNAVAILABLE = "تعذّر قراءة رصيدك الآن. جرّب /mypoints مرة أخرى.";
const MULTIPLE = "عندك أكثر من رصيد مختلف. اكتب /mypoints مرة في المجموعة التي تريد رصيدها، ثم أعد /mypoints هنا.";

export function objectFor(env, name) {
  return env.GAMES.get(env.GAMES.idFromName(String(name)));
}

export async function readJson(object, path) {
  const response = await object.fetch(new Request(`https://game.internal${path}`));
  if (!response.ok) throw new Error("Score lookup failed");
  return response.json();
}

async function rememberGroup(env, objectName, chat, rememberActivity = false) {
  const response = await objectFor(env, objectName).fetch(new Request("https://game.internal/score-groups", {
    method: "PUT",
    body: JSON.stringify({ id: chat.id, title: chat.title, rememberActivity }),
  }));
  if (!response.ok) throw new Error("Score group registration failed");
}

// A player's most recent /mypoints request in a group selects the balance shown privately.
export function rememberScoreGroup(env, userId, chat) {
  return rememberGroup(env, `player:${userId}`, chat, true);
}

export function rememberLeaderboardGroup(env, chat) {
  return rememberGroup(env, "score-catalog", chat);
}

function playerName(user) {
  const name = [user.first_name, user.last_name].filter(value => typeof value === "string").join(" ")
    .replace(/[\r\n\t]/g, " ").trim();
  return name || `لاعب ${user.id}`;
}

export async function privatePointsMessage(env, user) {
  const userId = user.id;
  const groups = await readJson(objectFor(env, `player:${userId}`), "/score-groups");
  if (!groups.length) return NO_HISTORY;

  const checked = await Promise.allSettled(groups.map(async group => {
    const score = await readJson(objectFor(env, group.id), `/player-score?user_id=${userId}`);
    return score ? { group, score } : null;
  }));
  const found = checked.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []);
  const unavailable = checked.some(row => row.status === "rejected");
  if (!found.length) return unavailable ? UNAVAILABLE : NO_HISTORY;

  // Never silently combine balances from distinct chat IDs, even if their titles match.
  const nonzero = found.filter(row => row.score.points !== 0 || row.score.wins !== 0);
  const recent = found.filter(row => Number.isFinite(row.group.lastSeenAt) && row.group.lastSeenAt > 0)
    .sort((a, b) => b.group.lastSeenAt - a.group.lastSeenAt);
  let chosen;
  // Prefer the only earned balance over a stray zero from an older or test group.
  if (found.length === 1) chosen = found[0];
  else if (nonzero.length === 1) chosen = nonzero[0];
  else if (recent.length && (recent.length === 1 || recent[0].group.lastSeenAt > recent[1].group.lastSeenAt)) {
    chosen = recent[0];
  } else {
    return unavailable ? UNAVAILABLE : MULTIPLE;
  }
  if (unavailable) return UNAVAILABLE; // No guessing while some balances are inaccessible.
  const display = playerName(user);
  return `📊 نقاطك\n\n👤 ${display}: ${chosen.score.points} نقطة\n\n🏆 مرات الفوز: ${chosen.score.wins}`;
}
