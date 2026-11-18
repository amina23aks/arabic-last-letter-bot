import { objectFor, readJson } from "./private-scores.js";
import { telegram } from "./telegram.js";

const TTL = 5 * 60_000;
const PAGE_SIZE = 8;
const amounts = [1, 5, 10, 20, 50, 100];
const labels = {
  add: "إضافة نقاط",
  subtract: "خصم نقاط",
  points: "تصفير النقاط مع إبقاء مرات الفوز",
  stats: "تصفير النقاط ومرات الفوز",
};
const expired = "انتهت صلاحية القائمة. اكتب /managepoints لفتح قائمة جديدة.";
const denied = "إدارة النقاط غير متاحة لهذا الحساب.";

export function isOwner(env, from, chat) {
  const ids = (env.POINTS_OWNER_IDS || "").trim().split(/\s*,\s*/);
  return ids.length === 3 && new Set(ids).size === 3 &&
    ids.every(id => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) &&
    chat?.type === "private" && chat.id === from?.id && !from.is_bot &&
    ids.includes(String(from.id));
}

export async function routePointsAdmin(env, update) {
  const callback = update.callback_query;
  const from = callback?.from || update.message?.from;
  const chat = callback?.message?.chat || update.message?.chat;
  if (!isOwner(env, from, chat)) {
    if (callback) await telegram(env.BOT_TOKEN, "answerCallbackQuery", {
      callback_query_id: callback.id, text: denied,
    });
    else if (chat?.type === "private") await telegram(env.BOT_TOKEN, "sendMessage", {
      chat_id: chat.id, text: denied,
    });
    return new Response("OK");
  }
  return objectFor(env, `player:${from.id}`).fetch(new Request("https://game.internal/points-admin", {
    method: "POST", body: JSON.stringify(update),
  }));
}

function groupLabel(group) {
  return group.title ? `${group.title} (${group.id})` : String(group.id);
}

function pageButtons(items, page, title) {
  const start = page * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);
  const rows = visible.map((item, index) => [[title(item), `i${index}`]]);
  const navigation = [];
  if (page > 0) navigation.push(["السابق", "prev"]);
  if (start + PAGE_SIZE < items.length) navigation.push(["التالي", "next"]);
  if (navigation.length) rows.push(navigation);
  return { rows, visible, hasNext: start + PAGE_SIZE < items.length };
}

export async function pointsAdminMenu(env, storage, update) {
  const callback = update.callback_query;
  const from = callback?.from || update.message?.from;
  const chat = callback?.message?.chat || update.message?.chat;
  if (!isOwner(env, from, chat)) return new Response(null, { status: 403 });
  const call = (method, payload) => telegram(env.BOT_TOKEN, method, payload);
  let session = await storage.get("pointsAdmin");
  const now = Date.now();
  const customAmount = !callback && /^\d+$/.test(update.message.text.trim());
  const messageId = callback?.message?.message_id ?? (customAmount ? session?.messageId : undefined);

  async function show(text, rows) {
    session.token = crypto.randomUUID();
    await storage.put("pointsAdmin", session);
    const payload = {
      chat_id: chat.id, text,
      reply_markup: { inline_keyboard: rows.map(row => row.map(([text, action]) => ({
        text, callback_data: `mp:${session.token}:${action}`,
      }))) },
    };
    if (messageId !== undefined) await call("editMessageText", { ...payload, message_id: messageId });
    else await call("sendMessage", payload);
  }

  async function groups(page = 0) {
    const items = await readJson(objectFor(env, "score-catalog"), "/score-groups");
    const { rows, visible, hasNext } = pageButtons(items, page, groupLabel);
    session = { expiresAt: now + TTL, step: "groups", page, items: visible, hasNext };
    await show(items.length ? "اختر المجموعة." :
      "لا توجد مجموعات مفهرسة. اطلب /leaderboard في المجموعة أولًا.",
      rows);
  }

  async function players(group, page = 0) {
    const items = await readJson(objectFor(env, group.id), "/score-players");
    const { rows, visible, hasNext } = pageButtons(items, page, player => `${player.name.slice(0, 70)} (${player.id})`);
    session = { ...session, step: "players", group, page, items: visible, hasNext };
    await show(items.length ? `اختر لاعبًا من ${groupLabel(group)}.` : "لا توجد سجلات نقاط في هذه المجموعة.",
      [...rows, [["المجموعات", "groups"]]]);
  }

  if (!callback && !customAmount) {
    await groups();
    return new Response("OK");
  }
  if (customAmount && session?.step !== "amount") return new Response("OK");
  const [, token, action] = callback
    ? callback.data.split(":")
    : ["mp", session.token, update.message.text.trim()];
  if (!session || session.expiresAt <= now || token !== session.token) {
    if (callback) await call("answerCallbackQuery", { callback_query_id: callback.id, text: expired });
    else await call("sendMessage", { chat_id: chat.id, text: expired });
    return new Response("OK");
  }

  const { step, group, page, items, player } = session;
  const balance = player && `${groupLabel(group)} · ${player.name.slice(0, 100)} (${player.id})\n${player.points} نقطة، مرات الفوز: ${player.wins}`;
  const index = /^i(\d+)$/.exec(action)?.[1];
  const selected = index === undefined ? undefined : items?.[Number(index)];
  if (step === "confirm" && action === "apply") {
    const response = await objectFor(env, group.id).fetch(new Request("https://game.internal/score-adjustment", {
      method: "POST", body: JSON.stringify({
        id: token, actor: from.id, groupId: group.id, playerId: player.id,
        before: { points: player.points, wins: player.wins },
        operation: session.operation, amount: session.amount, expiresAt: session.expiresAt,
      }),
    }));
    if (!response.ok) throw new Error("Could not apply points adjustment");
    const result = await response.json();
    // Keep the confirmation available for retry until Telegram accepts the result.
    // The group transaction uses the same token on every retry.
    await call("editMessageText", {
      chat_id: chat.id, message_id: callback.message.message_id,
      text: result.after
        ? `تم تحديث ${player.name.slice(0, 100)} (${player.id}) في ${groupLabel(group)}.\n${result.after.points} نقطة، مرات الفوز: ${result.after.wins}`
        : "تغيّر رصيد اللاعب أو انتهت صلاحية التأكيد. اكتب /managepoints وحاول مجددًا.",
      reply_markup: { inline_keyboard: [] },
    });
    await storage.delete("pointsAdmin");
  } else if (action === "groups" || action === "cancel") {
    await groups();
  } else if (["groups", "players"].includes(step)) {
    if (selected && step === "groups") await players(selected);
    else if (selected) {
      const score = await readJson(objectFor(env, group.id), `/player-score?user_id=${selected.id}`);
      if (!score) await players(group, page);
      else {
        session = { ...session, step: "action", player: { ...selected, ...score } };
        await show(`${groupLabel(group)} · ${selected.name.slice(0, 100)} (${selected.id})\n${score.points} نقطة، مرات الفوز: ${score.wins}`,
          [...Object.entries(labels).map(([key, label]) => [[label, key]]), [["المجموعات", "groups"]]]);
      }
    } else if (action === "prev" || action === "next") {
      const next = page + (action === "next" ? 1 : -1);
      if (action === "next" ? session.hasNext : page > 0) {
        if (step === "groups") await groups(next);
        else await players(group, next);
      }
    }
  } else if (step === "action" && ["add", "subtract"].includes(action)) {
    session = { ...session, step: "amount", operation: action, messageId };
    await show(`${balance}\n${labels[action]} — اختر العدد أو أرسله في رسالة خاصة.`, [
      amounts.map(amount => [String(amount), String(amount)]), [["إلغاء", "cancel"]],
    ]);
  } else if ((step === "action" && ["points", "stats"].includes(action)) ||
             (step === "amount" && (customAmount || amounts.includes(Number(action))))) {
    const operation = step === "action" ? action : session.operation;
    const amount = step === "amount" ? Number(action) : 0;
    if (step === "amount" && (!Number.isSafeInteger(amount) || amount <= 0)) {
      await call("sendMessage", { chat_id: chat.id, text: "أرسل عددًا صحيحًا موجبًا." });
      return new Response("OK");
    }
    session = { ...session, step: "confirm", operation, amount, expiresAt: now + TTL };
    await show(`${balance}\nتأكيد: ${labels[operation]}${amount ? ` (${amount})` : ""}؟`, [
      [["تأكيد", "apply"], ["إلغاء", "cancel"]],
    ]);
  }
  if (callback) await call("answerCallbackQuery", { callback_query_id: callback.id });
  return new Response("OK");
}

export async function adjustScore(storage, change) {
  return storage.transaction(async txn => {
    const { id, actor, groupId, playerId, before, operation, amount, expiresAt } = change;
    if (!Object.hasOwn(labels, operation) ||
        (["add", "subtract"].includes(operation) && (!Number.isSafeInteger(amount) || amount <= 0))) {
      return { conflict: true };
    }
    const auditKey = `pointsAdminAudit:${id}`;
    const prior = await txn.get(auditKey);
    if (prior) return prior;
    const scores = await txn.get("scores");
    const player = scores?.[playerId];
    if (Date.now() >= expiresAt || !player || player.points !== before.points || player.wins !== before.wins) {
      return { conflict: true };
    }
    const points = operation === "add" ? player.points + amount :
      operation === "subtract" ? Math.max(0, player.points - amount) : 0;
    if (!Number.isSafeInteger(points)) return { conflict: true };
    const after = { points, wins: operation === "stats" ? 0 : player.wins };
    const audit = { id, actor, groupId, playerId, operation, amount, before, after, timestamp: Date.now() };
    await txn.put("scores", { ...scores, [playerId]: { ...player, ...after } });
    await txn.put(auditKey, audit);
    return audit;
  });
}
