const PAGE_SIZE = 20;
const NO_HISTORY = "لا توجد مجموعات مرتبطة برصيد محفوظ لحسابك. إذا لعبت سابقًا، اكتب /mypoints مرة واحدة في كل مجموعة، ثم أعد طلبه هنا.";
const UNAVAILABLE = "تعذّر قراءة بعض الأرصدة الآن. جرّب /mypoints مرة أخرى.";

export function objectFor(env, name) {
  return env.GAMES.get(env.GAMES.idFromName(String(name)));
}

export async function readJson(object, path) {
  const response = await object.fetch(new Request(`https://game.internal${path}`));
  if (!response.ok) throw new Error("Score lookup failed");
  return response.json();
}

async function rememberGroup(env, objectName, chat) {
  const response = await objectFor(env, objectName).fetch(new Request("https://game.internal/score-groups", {
    method: "PUT",
    body: JSON.stringify({ id: chat.id, title: chat.title }),
  }));
  if (!response.ok) throw new Error("Score group registration failed");
}

export function rememberScoreGroup(env, userId, chat) {
  return rememberGroup(env, `player:${userId}`, chat);
}

export function rememberLeaderboardGroup(env, chat) {
  return rememberGroup(env, "score-catalog", chat);
}

export async function privatePointsMessage(env, userId, text) {
  const groups = await readJson(objectFor(env, `player:${userId}`), "/score-groups");
  if (!groups.length) return NO_HISTORY;
  const requested = Number(text.split(/\s+/)[1]);
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const pageCount = Math.ceil(groups.length / PAGE_SIZE);
  if (page > pageCount) return `هذه الصفحة غير موجودة. اكتب /mypoints لعرض الصفحة الأولى (${pageCount} صفحات).`;

  const start = (page - 1) * PAGE_SIZE;
  const rows = await Promise.allSettled(groups.slice(start, start + PAGE_SIZE).map(async group => {
    const score = await readJson(objectFor(env, group.id), `/player-score?user_id=${userId}`);
    if (!score) return null;
    return `${group.title || `المجموعة ${group.id}`}: ${score.points} نقطة، مرات الفوز: ${score.wins}`;
  }));
  const balances = rows.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []);
  const unavailable = rows.some(row => row.status === "rejected");
  const pages = pageCount > 1
    ? `\n\nصفحة ${page} من ${pageCount}. اكتب /mypoints متبوعًا برقم الصفحة لتغييرها.`
    : "";
  const summary = balances.length ? `رصيدك حسب المجموعة:\n${balances.join("\n")}` : unavailable ? "" : NO_HISTORY;
  return [summary, unavailable ? UNAVAILABLE : ""].filter(Boolean).join("\n\n") + pages;
}
