import { adjustScore, isOwner, pointsAdminMenu, routePointsAdmin } from "./manage-points.js";
import { privatePointsMessage, rememberLeaderboardGroup, rememberScoreGroup } from "./private-scores.js";
import { help, parseCommand, welcome } from "./commands.js";
import { telegram, telegramErrorDetails } from "./telegram.js";

const REGISTRATION_MS = 120_000;
const TURN_MS = 15_000;
const MAX_LIVES = 3;
const MAX_PLAYERS = 30;
const MAX_WORD_LENGTH = 24;
const WIN_POINTS = 10;
const MAX_RECENT_REWARDS = 1000;
const SCORE_COMMANDS = new Set(["addpoints", "removepoints", "setpoints", "resetpoints"]);
const SCORE_COMMANDS_DISABLED = "تعديل النقاط معطّل حاليًا.";
const escapeHtml = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const newGame = () => ({
  phase: "idle", // idle | lobby | playing
  hostId: null,
  players: [],
  turnIndex: 0,
  requiredLetter: null,
  used: [],
  deadline: null,
  recentUpdates: [],
  roundId: null,
  pendingReward: null,
});

function display(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ")
    .replace(/[\r\n\t]/g, " ").trim();
  return name || `لاعب ${user.id}`;
}

function cleanStoredName(name) {
  return name.replace(/\s*\(@[a-z0-9_]+\)$/i, "");
}

function canonical(text) {
  return text
    .normalize("NFC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "ا");
}

function isWord(text) {
  const word = canonical(text.trim());
  return word.length >= 2 && word.length <= MAX_WORD_LENGTH &&
    /^[\u0627-\u064A]+$/u.test(word) ? word : null;
}

function aliveIndices(game) {
  return game.players.map((p, i) => p.lives > 0 ? i : -1).filter(i => i >= 0);
}

export function lifeIcons(lives) {
  return "💚".repeat(lives) + "🕊️".repeat(MAX_LIVES - lives);
}

function scoreboard(game) {
  return game.players.map((player, index) =>
    `${index + 1}. ${escapeHtml(player.name)} — ${lifeIcons(player.lives)}`
  ).join("\n");
}

function lobbyMessage(game) {
  const names = game.players.map((player, index) => `${index + 1}. ${player.name}`).join("\n");
  return `فُتح التسجيل للعبة آخر حرف لمدة 120 ثانية.\n\nعدد المسجلين: ${game.players.length}\n\n${names}\n\nيمكن لصاحب الجولة أو مشرف المجموعة البدء بعد تسجيل لاعبين على الأقل.`;
}

function lobbyKeyboard(game) {
  return { inline_keyboard: [[
    { text: "انضمام للجولة", callback_data: `join:${game.roundId}` },
    { text: "بدء الجولة", callback_data: `start:${game.roundId}` },
  ]] };
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function nextIndex(game, oldIndex) {
  for (let offset = 1; offset <= game.players.length; offset++) {
    const i = (oldIndex + offset) % game.players.length;
    if (game.players[i].lives > 0) return i;
  }
  return -1;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Arabic last-letter game bot is running ✅");
    }
    // Optional read-only integration API; disabled until SCORE_API_KEY is configured.
    if (request.method === "GET" && ["/api/scores", "/api/rewards"].includes(url.pathname)) {
      if (!env.SCORE_API_KEY || request.headers.get("Authorization") !== `Bearer ${env.SCORE_API_KEY}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      const chatId = url.searchParams.get("chat_id");
      if (!/^-?\d+$/.test(chatId || "")) return new Response("Invalid chat_id", { status: 400 });
      const id = env.GAMES.idFromName(chatId);
      const object = env.GAMES.get(id);
      return object.fetch(`https://game.internal${url.pathname}`);
    }

    if (request.method !== "POST" || url.pathname !== "/webhook" ||
      !env.WEBHOOK_SECRET || !env.BOT_TOKEN ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const update = await request.json();
      const msg = update.message;
      const callback = update.callback_query;
      const chat = msg?.chat || callback?.message?.chat;
      if (callback?.data?.startsWith("mp:")) return await routePointsAdmin(env, update);
      if (chat?.type === "private" && msg?.text && !msg.from?.is_bot) {
        const command = parseCommand(msg.text.trim());
        if (!command && /^\d+$/.test(msg.text.trim()) && isOwner(env, msg.from, chat)) {
          return await routePointsAdmin(env, update);
        }
        if (!command?.addressedHere) return new Response("OK");
        if (command.name === "managepoints") return await routePointsAdmin(env, update);
        const userId = msg.from?.id;
        if (command.name === "mytelegramid" && Number.isSafeInteger(userId) && userId > 0 && userId === chat.id) {
          await telegram(env.BOT_TOKEN, "sendMessage", { chat_id: chat.id, text: `Telegram ID: ${userId}` });
          return new Response("OK");
        }
        const replies = {
          start: welcome,
          help,
          rules: help,
        };
        const scoreRequest = ["mypoints", "points"].includes(command.name);
        const message = scoreRequest && Number.isSafeInteger(userId) && userId > 0 && userId === chat.id
          ? await privatePointsMessage(env, msg.from)
          : Object.hasOwn(replies, command.name) && replies[command.name];
        if (message) await telegram(env.BOT_TOKEN, "sendMessage", { chat_id: chat.id, text: message });
        return new Response("OK");
      } else if (!chat || !["group", "supergroup"].includes(chat.type)) {
        return new Response("OK");
      }
      const id = env.GAMES.idFromName(String(chat.id));
      const object = env.GAMES.get(id);
      return await object.fetch(new Request("https://game.internal/update", {
        method: "POST", body: JSON.stringify(update),
      }));
    } catch (error) {
      console.error("Webhook processing failed", telegramErrorDetails(error));
      return new Response("Temporary error", { status: 500 });
    }
  },
};

export class WordGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.pending = Promise.resolve();
  }

  // Serialize game updates and alarms, including across Telegram API calls.
  runExclusive(action) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }

  callTelegram(method, payload) {
    return telegram(this.env.BOT_TOKEN, method, payload);
  }

  async tryTelegram(method, payload) {
    try {
      return await this.callTelegram(method, payload);
    } catch (error) {
      console.error(`Telegram ${method} failed`, telegramErrorDetails(error));
    }
  }

  async canManage(game, userId) {
    if (game.hostId === userId) return true;
    const member = await this.tryTelegram("getChatMember", { chat_id: game.chatId, user_id: userId });
    return member?.status === "administrator" || member?.status === "creator";
  }

  // Persist game state and points in one transaction. A round can be awarded only once,
  // including after a retried webhook/alarm or process restart.
  async save(game) {
    const pendingAward = game.pendingReward;
    await this.ctx.storage.transaction(async (txn) => {
      const scores = (await txn.get("scores")) || {};
      let dirty = false;
      // Every participant has a durable personal balance, initially 0.
      for (const player of game.players || []) {
        const key = String(player.id); // Telegram numeric ID, NOT mutable @username.
        if (!scores[key]) {
          scores[key] = { user_id: player.id, name: player.name, points: 0, wins: 0 };
          dirty = true;
        } else if (scores[key].name !== player.name) {
          scores[key].name = player.name;
          dirty = true;
        }
      }
      if (pendingAward) {
        const award = pendingAward;
        const awardKey = `award:${award.event_id}`;
        if (!(await txn.get(awardKey))) {
          const key = String(award.user_id);
          if (!scores[key]) scores[key] = {
            user_id: award.user_id, name: award.name, points: 0, wins: 0,
          };
          scores[key].points += award.points;
          scores[key].wins += 1;
          scores[key].name = award.name;
          dirty = true;
          const events = (await txn.get("rewardEvents")) || [];
          events.push(award);
          await txn.put("rewardEvents", events.slice(-MAX_RECENT_REWARDS));
          await txn.put(awardKey, true);
        }
      }
      if (dirty) await txn.put("scores", scores);
      await txn.put("game", { ...game, pendingReward: null });
      if (game.phase !== "idle" && game.deadline != null) await txn.setAlarm(game.deadline);
      else await txn.deleteAlarm();
    });
    game.pendingReward = null;
  }

  async notify(chatId, texts) {
    for (const text of texts) {
      await this.tryTelegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
    }
  }

  async closeLobby(chatId, messageId) {
    if (messageId == null) return;
    await this.tryTelegram("editMessageReplyMarkup", {
      chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] },
    });
  }

  turnMessage(game) {
    const player = game.players[game.turnIndex];
    const instruction = game.requiredLetter
      ? `اكتب كلمة تبدأ بحرف: <b>${escapeHtml(game.requiredLetter)}</b>`
      : "يمكنك اختيار أي كلمة عربية صالحة.";
    return `دور ${escapeHtml(player.name)}!\n\n${instruction}\n\n⏳ الوقت المتبقي: 15 ثانية\n\nالفرص: ${lifeIcons(player.lives)} (${player.lives}/${MAX_LIVES})`;
  }

  startRound(game, texts, now) {
    game.players = shuffled(game.players);
    game.phase = "playing";
    game.turnIndex = 0;
    game.requiredLetter = null;
    game.used = [];
    game.deadline = now + TURN_MS;
    texts.push(`بدأت الجولة! التسجيل مغلق.\n\nترتيب اللعب:\n\n${scoreboard(game)}\n\nلكل لاعب 3 فرص.`);
    texts.push(this.turnMessage(game));
  }

  async loadGame() {
    const game = (await this.ctx.storage.get("game")) || newGame();
    game.recentUpdates ??= [];
    for (const player of game.players) player.name = cleanStoredName(player.name);
    return game;
  }

  // This function changes the state; callers persist it before sending messages.
  finishOrAdvance(game, priorIndex, texts, now) {
    const alive = aliveIndices(game);
    if (alive.length <= 1) {
      const winnerPlayer = alive.length === 1 ? game.players[alive[0]] : null;
      const winner = winnerPlayer?.name ?? "لا أحد";
      if (winnerPlayer) {
        if (!game.roundId) game.roundId = crypto.randomUUID();
        game.pendingReward = {
          event_id: `${game.chatId}:${game.roundId}`,
          source: "EndToStartBot",
          chat_id: game.chatId,
          round_id: game.roundId,
          user_id: winnerPlayer.id,
          name: winnerPlayer.name,
          points: WIN_POINTS,
          created_at: new Date(now).toISOString(),
        };
      }
      const reward = winnerPlayer ? `\n\n🎁 +${WIN_POINTS} نقاط للفائز` : "";
      texts.push(`🏁 انتهت الجولة!\n\n🏆 الفائز: ${escapeHtml(winner)}${reward}\n\n📊 النتائج:\n${scoreboard(game)}\n\nاكتب /start لفتح جولة جديدة.`);
      game.phase = "idle";
      game.hostId = null;
      game.deadline = null;
      return;
    }
    game.turnIndex = nextIndex(game, priorIndex);
    game.deadline = now + TURN_MS;
    texts.push(this.turnMessage(game));
  }

  expireTurn(game, texts, now) {
    const old = game.turnIndex;
    const p = game.players[old];
    p.lives -= 1;
    texts.push(`انتهى وقت ${escapeHtml(p.name)}. الفرص: ${lifeIcons(p.lives)} (${p.lives}/${MAX_LIVES})${p.lives === 0 ? " — خرج من الجولة." : ""}`);
    this.finishOrAdvance(game, old, texts, now);
  }

  expireLobby(game, texts, now) {
    const messageId = game.lobbyMessageId;
    game.lobbyMessageId = null;
    if (game.players.length >= 2) {
      this.startRound(game, texts, now);
    } else {
      game.phase = "idle";
      game.hostId = null;
      game.deadline = null;
      game.players = [];
      texts.push("انتهى التسجيل وأُلغيت الجولة لعدم تسجيل لاعبين على الأقل.");
    }
    return messageId;
  }

  alarm() {
    return this.runExclusive(async () => {
      const game = await this.loadGame();
      if (game.phase === "idle" || game.deadline == null) return;
      const now = Date.now();
      if (now < game.deadline) {
        await this.ctx.storage.setAlarm(game.deadline);
        return;
      }

      const texts = [];
      let closedMessage;
      if (game.phase === "lobby") closedMessage = this.expireLobby(game, texts, now);
      else this.expireTurn(game, texts, now);
      await this.save(game);
      await this.closeLobby(game.chatId, closedMessage);
      await this.notify(game.chatId, texts);
    });
  }

  async fetch(request) {
    const { pathname: path, searchParams } = new URL(request.url);
    if (request.method === "GET" && ["/api/scores", "/api/rewards"].includes(path)) {
      const data = path === "/api/scores"
        ? ((await this.ctx.storage.get("scores")) || {})
        : ((await this.ctx.storage.get("rewardEvents")) || []);
      return Response.json({
        version: 1,
        source: "EndToStartBot",
        type: path === "/api/scores" ? "score_snapshot" : "reward_events",
        data: path === "/api/scores" ? Object.values(data) : data,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
      if (path === "/points-admin" && request.method === "POST") {
        const update = await request.json();
        return await this.runExclusive(() => pointsAdminMenu(this.env, this.ctx.storage, update));
      }
      if (path === "/score-adjustment" && request.method === "POST") {
        const change = await request.json();
        return Response.json(await this.runExclusive(() => adjustScore(this.ctx.storage, change)));
      }
      if (path === "/score-players" && request.method === "GET") {
        const scores = (await this.ctx.storage.get("scores")) || {};
        const players = Object.entries(scores)
          .map(([id, score]) => ({
            id: Number(id),
            name: cleanStoredName(score.name || `لاعب ${id}`),
            points: score.points,
            wins: score.wins,
          }))
          .filter(player => Number.isSafeInteger(player.id) && player.id > 0)
          .sort((a, b) => b.points - a.points || b.wins - a.wins || a.id - b.id);
        return Response.json(players.map(({ id, name }) => ({ id, name })));
      }
      if (path === "/score-groups") {
        if (request.method === "GET") {
          const groups = await this.ctx.storage.list({ prefix: "scoreGroup:" });
          return Response.json([...groups.values()]);
        }
        if (request.method === "PUT") {
          const { id, title, rememberActivity } = await request.json();
          if (!Number.isSafeInteger(id) || id >= 0) return new Response(null, { status: 400 });
          const key = `scoreGroup:${id}`;
          const prior = await this.ctx.storage.get(key);
          const name = typeof title === "string" ? title.trim().replace(/\s+/g, " ").slice(0, 100) : "";
          if (rememberActivity || name || !prior) {
            await this.ctx.storage.put(key, {
              id, title: name || prior?.title || "",
              ...(rememberActivity ? { lastSeenAt: Date.now() } : prior?.lastSeenAt ? { lastSeenAt: prior.lastSeenAt } : {}),
            });
          }
          return new Response(null, { status: 204 });
        }
      }
      if (path === "/player-score" && request.method === "GET") {
        const userId = Number(searchParams.get("user_id"));
        if (!Number.isSafeInteger(userId) || userId <= 0) return new Response(null, { status: 400 });
        const entry = (await this.ctx.storage.get("scores"))?.[userId];
        return Response.json(entry ? { points: entry.points, wins: entry.wins } : null);
      }
      const update = await request.json();
      return await this.runExclusive(() => this.handleUpdate(update));
    } catch (error) {
      console.error("Game update failed", telegramErrorDetails(error));
      return new Response("Temporary error", { status: 500 });
    }
  }

  async updateScoreIndex(chat, userId) {
    const writes = [rememberLeaderboardGroup(this.env, chat)];
    if (userId) writes.push(rememberScoreGroup(this.env, userId, chat));
    const results = await Promise.allSettled(writes);
    if (results.some(result => result.status === "rejected")) {
      console.error("Could not update score index");
      return false;
    }
    return true;
  }

  async pointsMessage(from, chat) {
    const scores = (await this.ctx.storage.get("scores")) || {};
    const entry = scores[String(from.id)];
    const indexed = await this.updateScoreIndex(chat, entry && from.id);
    const retry = indexed ? "" : "\nتعذّر تحديث الربط مع الخاص. أعد طلب /mypoints في المجموعة لاحقًا.";

    return `رصيد ${escapeHtml(display(from))}: ${entry?.points || 0} نقطة\nمرات الفوز: ${entry?.wins || 0}${retry}`;
  }

  async handleUpdate(update) {
    const msg = update.message;
    const callback = update.callback_query;
    const chat = msg?.chat || callback?.message?.chat;
    const from = msg?.from || callback?.from;
    if (!["group", "supergroup"].includes(chat?.type) || !Number.isSafeInteger(from?.id) || from.id <= 0 || from.is_bot) return new Response("OK");

    const raw = (msg?.text || "").trim();
    const parsed = parseCommand(raw);
    if (parsed && !parsed.addressedHere) return new Response("OK");
    const command = parsed?.name;
    if (SCORE_COMMANDS.has(command)) {
      await this.notify(chat.id, [SCORE_COMMANDS_DISABLED]);
      return new Response("OK");
    }
    if (callback?.data?.startsWith("resetpoints:")) {
      await this.tryTelegram("answerCallbackQuery", {
        callback_query_id: callback.id, text: SCORE_COMMANDS_DISABLED,
      });
      return new Response("OK");
    }
    let game = await this.loadGame();
    game.chatId = chat.id;
    if (game.recentUpdates.includes(update.update_id)) {
      if (callback) await this.tryTelegram("answerCallbackQuery", { callback_query_id: callback.id });
      return new Response("OK");
    }
    if (typeof update.update_id === "number") {
      game.recentUpdates.push(update.update_id);
      if (game.recentUpdates.length > 100) game.recentUpdates.shift();
    }

    const texts = [];
    let callbackText = "التسجيل مغلق حاليًا.";
    let closedMessage;
    let createdLobby = false;
    let joinedLobby = false;
    let editedLobby = false;
    let expired = false;

    // Old keyboards used an unscoped "join" callback. Only accept it for existing lobbies.
    const legacyLobby = game.phase === "lobby" && (game.deadline == null || game.legacyLobby);
    const matchesRound = game.phase === "lobby" && callback && (
      callback.data === `join:${game.roundId}` || callback.data === `start:${game.roundId}` ||
      (legacyLobby && callback.data === "join" &&
        (game.lobbyMessageId == null || game.lobbyMessageId === callback.message.message_id))
    );
    if (matchesRound && game.lobbyMessageId == null) {
      game.lobbyMessageId = callback.message.message_id;
    }
    const earlyStart = matchesRound && callback.data.startsWith("start:");
    const cancel = command === "cancelgame";
    const authorized = ((earlyStart && game.phase === "lobby") || (cancel && game.phase !== "idle"))
      && await this.canManage(game, from.id);
    const now = Date.now();

    if (game.phase === "lobby" && game.deadline == null) {
      game.roundId ??= crypto.randomUUID();
      game.legacyLobby = true;
      game.deadline = now + REGISTRATION_MS;
    }
    const player = game.players.find((entry) => entry.id === from.id);
    if (player && game.phase !== "idle") player.name = display(from);

    if (game.phase === "lobby" && now >= game.deadline) {
      closedMessage = this.expireLobby(game, texts, now);
      expired = true;
    } else if (game.phase === "playing" && now >= game.deadline) {
      this.expireTurn(game, texts, now);
      expired = true;
    }

    if (command === "startgame") {
      texts.push("اضغط «بدء الجولة» في رسالة التسجيل للبدء مبكرًا.");
    } else if (earlyStart) {
      let error;
      if (game.phase !== "lobby") error = "التسجيل مغلق. اكتب /start لفتح جولة جديدة.";
      else if (!authorized) error = "يمكن لصاحب الجولة أو مشرف المجموعة فقط بدء الجولة.";
      else if (game.players.length < 2) error = "نحتاج لاعبين اثنين على الأقل.";
      else {
        closedMessage = game.lobbyMessageId;
        game.lobbyMessageId = null;
        this.startRound(game, texts, now);
      }
      callbackText = error || "بدأت الجولة.";
    } else if (callback) {
      if (matchesRound && !expired) {
        if (player) {
          callbackText = "أنت مسجل من قبل.";
          editedLobby = legacyLobby;
        } else if (game.players.length >= MAX_PLAYERS) {
          callbackText = "وصلنا للحد الأقصى (30 لاعبًا).";
        } else {
          joinedLobby = true;
          game.players.push({ id: from.id, name: display(from), lives: MAX_LIVES });
          callbackText = "تم تسجيلك.";
          editedLobby = true;
        }
      }
    } else if (command === "help" || command === "rules") {
      texts.push(help);
    } else if (command === "start" || command === "game") {
      if (game.phase !== "idle") texts.push("هناك تسجيل مفتوح أو جولة جارية بالفعل.");
      else {
        game = {
          ...newGame(),
          recentUpdates: game.recentUpdates,
          chatId: chat.id,
          phase: "lobby",
          roundId: crypto.randomUUID(),
          hostId: from.id,
          players: [{ id: from.id, name: display(from), lives: MAX_LIVES }],
        };
        createdLobby = true;
      }
    } else if (command === "players") {
      texts.push(game.players.length
        ? `المشاركون (${game.players.length}):\n${scoreboard(game)}`
        : "لا يوجد لاعبون مسجلون. اكتب /start.");
    } else if (command === "points" || command === "mypoints") {
      texts.push(await this.pointsMessage(from, chat));
    } else if (["playerpointendtostartgame", "leaderboard", "top"].includes(command)) {
      const scores = (await this.ctx.storage.get("scores")) || {};
      await this.updateScoreIndex(chat);
      const ranking = Object.values(scores).sort((a, b) => b.points - a.points || b.wins - a.wins)
        .slice(0, 20);
      texts.push(ranking.length
        ? `ترتيب النقاط الإجمالي:\n${ranking.map((p, i) => `${i + 1}. ${escapeHtml(cleanStoredName(p.name))}: ${p.points} نقطة (${p.wins} فوز)`).join("\n")}`
        : "لا يوجد رصيد نقاط بعد. اكتب /start وابدأ الجولة!");
    } else if (command === "status") {
      const left = Math.max(0, Math.ceil((game.deadline - now) / 1000));
      if (game.phase === "playing") {
        texts.push(`الجولة مستمرة.\nالدور: ${escapeHtml(game.players[game.turnIndex].name)}\nالحرف: ${game.requiredLetter ? `<b>${escapeHtml(game.requiredLetter)}</b>` : "حر"}\nالمتبقي: ${left} ثانية\n\n${scoreboard(game)}`);
      } else if (game.phase === "lobby") {
        texts.push(`التسجيل مفتوح. عدد المسجلين: ${game.players.length}. الوقت المتبقي: ${left} ثانية.`);
      } else texts.push("لا توجد جولة حاليًا. اكتب /start.");
    } else if (cancel) {
      if (game.phase === "idle") texts.push("لا توجد جولة لإلغائها.");
      else if (!authorized) texts.push("يمكن لصاحب الجولة أو مشرف المجموعة فقط الإلغاء.");
      else {
        if (game.phase === "lobby") closedMessage = game.lobbyMessageId;
        game = { ...newGame(), recentUpdates: game.recentUpdates, chatId: chat.id };
        texts.push("تم إلغاء الجولة. اكتب /start لفتح جولة جديدة.");
      }
    } else if (!raw.startsWith("/") && msg?.text && !expired && game.phase === "playing") {
      const currentPlayer = game.players[game.turnIndex];
      const turnStartedAt = Math.floor((game.deadline - TURN_MS) / 1000);
      if (currentPlayer.id === from.id && (msg.date == null || msg.date >= turnStartedAt)) {
        const word = isWord(raw);
        if (!word) texts.push("اكتب كلمة عربية واحدة من حرفين إلى 24 حرفًا، بدون أرقام أو مسافات.");
        else if (game.requiredLetter && word[0] !== game.requiredLetter) {
          texts.push(`لازم تبدأ الكلمة بحرف «<b>${escapeHtml(game.requiredLetter)}</b>». جرّب مرة أخرى قبل انتهاء الوقت.`);
        } else if (game.used.includes(word)) {
          texts.push("هذه الكلمة استُعملت من قبل. اختر كلمة أخرى.");
        } else {
          game.used.push(word);
          game.requiredLetter = word[word.length - 1];
          this.finishOrAdvance(game, game.turnIndex, texts, now);
        }
      }
    }

    if (createdLobby) {
      // Publish the keyboard before committing a lobby that players need it to join.
      const message = await this.callTelegram("sendMessage", {
        chat_id: chat.id, text: lobbyMessage(game), reply_markup: lobbyKeyboard(game),
      });
      game.lobbyMessageId = message.message_id;
      game.deadline = Date.now() + REGISTRATION_MS;
    }
    await this.save(game);
    if (createdLobby || joinedLobby) await this.updateScoreIndex(chat, from.id);

    if (callback) {
      await this.tryTelegram("answerCallbackQuery", {
        callback_query_id: callback.id, text: callbackText, show_alert: false,
      });
    }
    await this.closeLobby(chat.id, closedMessage);
    await this.notify(chat.id, texts);
    if (editedLobby && game.lobbyMessageId != null) {
      await this.tryTelegram("editMessageText", {
        chat_id: chat.id, message_id: game.lobbyMessageId,
        text: lobbyMessage(game), reply_markup: lobbyKeyboard(game),
      });
    }
    return new Response("OK");
  }
}
