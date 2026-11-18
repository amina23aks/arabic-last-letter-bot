const TURN_MS = 15_000;
const MAX_LIVES = 3;
const MAX_PLAYERS = 30;
const MAX_WORD_LENGTH = 24;
const WIN_POINTS = 10;
const MAX_RECENT_REWARDS = 1000;

// Telegram plain-text messages: no untrusted user text is interpreted as HTML.
async function telegram(env, method, payload) {
  const result = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await result.json();
  if (!result.ok || !data.ok) {
    throw new Error(`Telegram ${method}: ${data.description ?? result.status}`);
  }
  return data.result;
}

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
  const name = (user.first_name || user.username || `لاعب ${user.id}`)
    .replace(/[\r\n\t]/g, " ").slice(0, 36);
  return user.username ? `${name} (@${user.username})` : name;
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

function scoreboard(game) {
  return game.players.map((p, i) =>
    `${i + 1}. ${p.name} — ${"❤️".repeat(p.lives)}${"🖤".repeat(MAX_LIVES - p.lives)}`
  ).join("\n");
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
      if (!chat || !["group", "supergroup"].includes(chat.type)) {
        return new Response("OK");
      }
      const id = env.GAMES.idFromName(String(chat.id));
      const object = env.GAMES.get(id);
      return await object.fetch("https://game.internal/update", {
        method: "POST", body: JSON.stringify(update),
      });
    } catch (e) {
      console.error("Webhook error", e);
      return new Response("Temporary error", { status: 500 });
    }
  },
};

export class WordGame {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async send(chatId, text, extra = {}) {
    return telegram(this.env, "sendMessage", { chat_id: chatId, text, ...extra });
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
    });
    game.pendingReward = null;
    if (game.phase === "playing" && game.deadline != null) {
      await this.ctx.storage.setAlarm(game.deadline);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async notify(chatId, texts) {
    for (const text of texts) {
      try { await this.send(chatId, text); }
      catch (e) { console.error("Send failed", e); }
    }
  }

  turnMessage(game) {
    const p = game.players[game.turnIndex];
    const instruction = game.requiredLetter
      ? `🔤 اكتب كلمة تبدأ بحرف: ${game.requiredLetter}`
      : "🔤 أنت تبدأ الجولة: اكتب أي كلمة عربية.";
    return `🎯 دور ${p.name}!\n${instruction}\n⏳ لديك 15 ثانية.\n❤️ حيواتك: ${p.lives}/${MAX_LIVES}`;
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
      texts.push(`🏆 انتهت الجولة!\nالفائز: ${winner}\n${winnerPlayer ? `🎁 +${WIN_POINTS} نقاط للفائز!\n` : ""}\n📊 النتائج:\n${scoreboard(game)}\n\nاكتب /game لفتح جولة جديدة.`);
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
    texts.push(`⏰ انتهت الـ15 ثانية على ${p.name}!\n💔 خسر حياة. المتبقي: ${p.lives}/${MAX_LIVES}${p.lives === 0 ? "\n❌ تم إقصاؤه من الجولة." : ""}`);
    this.finishOrAdvance(game, old, texts, now);
  }

  async alarm() {
    const game = await this.ctx.storage.get("game");
    if (!game || game.phase !== "playing" || game.deadline == null) return;
    const now = Date.now();
    if (now < game.deadline) {
      await this.ctx.storage.setAlarm(game.deadline);
      return;
    }
    const texts = [];
    this.expireTurn(game, texts, now);
    await this.save(game);
    await this.notify(game.chatId, texts);
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
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
    const update = await request.json();
    const msg = update.message;
    const callback = update.callback_query;
    const chat = msg?.chat || callback?.message?.chat;
    const from = msg?.from || callback?.from;
    if (!chat || !from || from.is_bot) return new Response("OK");

    let game = (await this.ctx.storage.get("game")) || newGame();
    game.chatId = chat.id;
    const texts = [];
    let callbackText = null;
    let createdLobby = false;
    const now = Date.now();

    // Telegram may resend an update after a timeout. Keep a bounded deduplication history.
    if (typeof update.update_id === "number") {
      if (game.recentUpdates.includes(update.update_id)) {
        if (callback) {
          try { await telegram(this.env, "answerCallbackQuery", { callback_query_id: callback.id }); }
          catch (e) { console.error(e); }
        }
        return new Response("OK");
      }
      game.recentUpdates.push(update.update_id);
      if (game.recentUpdates.length > 100) game.recentUpdates.shift();
    }

    // Deadline is authoritative even if an alarm arrives a little late.
    if (game.phase === "playing" && now >= game.deadline) {
      this.expireTurn(game, texts, now);
    }

    const raw = (msg?.text || "").trim();
    const command = raw.match(/^\/(\w+)(?:@\w+)?(?:\s|$)/)?.[1]?.toLowerCase();

    if (callback && callback.data === "join") {
      if (game.phase !== "lobby") callbackText = "التسجيل مغلق حاليًا.";
      else if (game.players.some(p => p.id === from.id)) callbackText = "أنت مسجل من قبل ✅";
      else if (game.players.length >= MAX_PLAYERS) callbackText = "وصلنا للحد الأقصى (30 لاعبًا).";
      else {
        game.players.push({ id: from.id, name: display(from), lives: MAX_LIVES });
        callbackText = "تم تسجيلك ✅";
        texts.push(`✅ انضم ${display(from)}! (${game.players.length} لاعب)\nاكتب /players لمشاهدة القائمة.`);
      }
    } else if (command === "start") {
      texts.push("🎮 أهلاً بك! أضف البوت لمجموعة ثم اكتب /game لفتح التسجيل، /startgame للبدء، /points لرصيدك، /leaderboard للترتيب. يجب تعطيل Privacy Mode ليقرأ كلمات اللاعبين.");
    } else if (command === "game") {
      if (game.phase !== "idle") texts.push("⚠️ هناك تسجيل أو جولة جارية. استخدم /status.");
      else {
        const previous = game.recentUpdates;
        game = newGame();
        game.recentUpdates = previous;
        game.chatId = chat.id;
        game.phase = "lobby";
        game.roundId = crypto.randomUUID();
        createdLobby = true;
        game.hostId = from.id;
        game.players.push({ id: from.id, name: display(from), lives: MAX_LIVES });
        // Special lobby message with join button is sent below.
      }
    } else if (command === "players") {
      texts.push(game.players.length
        ? `👥 المشاركون (${game.players.length}):\n${scoreboard(game)}`
        : "لا يوجد لاعبون مسجلون. اكتب /game.");
    } else if (command === "points" || command === "mypoints") {
      const scores = (await this.ctx.storage.get("scores")) || {};
      const entry = scores[String(from.id)];
      texts.push(`💰 رصيد ${display(from)}: ${entry?.points || 0} نقطة\n🏆 مرات الفوز: ${entry?.wins || 0}`);
    } else if (command === "leaderboard" || command === "top") {
      const scores = (await this.ctx.storage.get("scores")) || {};
      const ranking = Object.values(scores).sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, 20);
      texts.push(ranking.length
        ? `🏆 ترتيب النقاط الإجمالي (يبقى بعد كل جولة):\n${ranking.map((p, i) => `${i + 1}. ${p.name}: ${p.points} نقطة (${p.wins} فوز)`).join("\n")}`
        : "لا يوجد رصيد نقاط بعد. اكتب /game وابدأ الجولة!");
    } else if (command === "startgame") {
      if (game.phase !== "lobby") texts.push("⚠️ افتح التسجيل أولًا باستعمال /game.");
      else if (game.hostId !== from.id) texts.push("⚠️ فقط صاحب الجولة يستطيع بدءها.");
      else if (game.players.length < 2) texts.push("⚠️ نحتاج لاعبين اثنين على الأقل.");
      else {
        game.players = shuffled(game.players);
        game.phase = "playing";
        game.turnIndex = 0;
        game.requiredLetter = null;
        game.used = [];
        game.deadline = now + TURN_MS;
        texts.push(`🚀 بدأت الجولة! التسجيل مغلق.\n🔀 ترتيب اللعب:\n${game.players.map((p, i) => `${i+1}. ${p.name}`).join("\n")}\n❤️ لكل لاعب 3 حيوات.`);
        texts.push(this.turnMessage(game));
      }
    } else if (command === "status") {
      if (game.phase === "playing") {
        const left = Math.max(0, Math.ceil((game.deadline - now) / 1000));
        texts.push(`🎮 الجولة مستمرة.\n🎯 الدور: ${game.players[game.turnIndex].name}\n🔤 الحرف: ${game.requiredLetter || "حر"}\n⏳ المتبقي تقريبًا: ${left} ثانية\n\n${scoreboard(game)}`);
      } else if (game.phase === "lobby") {
        texts.push(`📝 التسجيل مفتوح. ${game.players.length} لاعب. صاحب الجولة يكتب /startgame عند الجاهزية.`);
      } else texts.push("لا توجد جولة حاليًا. اكتب /game.");
    } else if (command === "cancelgame") {
      if (game.phase === "idle") texts.push("لا توجد جولة لإلغائها.");
      else if (game.hostId !== from.id) texts.push("⚠️ فقط صاحب الجولة يمكنه الإلغاء.");
      else {
        const oldRecent = game.recentUpdates;
        game = newGame();
        game.recentUpdates = oldRecent;
        game.chatId = chat.id;
        texts.push("🛑 تم إلغاء الجولة. اكتب /game لفتح جولة جديدة.");
      }
    } else if (!command && msg?.text && game.phase === "playing") {
      const player = game.players[game.turnIndex];
      if (player.id === from.id) {
        const word = isWord(raw);
        if (!word) texts.push("❌ اكتب كلمة عربية واحدة من حرفين إلى 24 حرفًا، بدون أرقام أو مسافات.");
        else if (game.requiredLetter && word[0] !== game.requiredLetter) {
          texts.push(`❌ لازم تبدأ الكلمة بحرف «${game.requiredLetter}». جرّب مرة أخرى قبل انتهاء الوقت.`);
        } else if (game.used.includes(word)) {
          texts.push("❌ هذه الكلمة استُعملت من قبل. اختر كلمة أخرى.");
        } else {
          game.used.push(word);
          game.requiredLetter = word[word.length - 1];
          texts.push(`✅ صحيح من ناحية الحروف! ${player.name}: ${raw}\n🔤 الحرف التالي: ${game.requiredLetter}`);
          this.finishOrAdvance(game, game.turnIndex, texts, now);
        }
      }
    }

    await this.save(game);

    if (callback) {
      try {
        await telegram(this.env, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: callbackText || "تم الاستلام",
          show_alert: false,
        });
      } catch (e) { console.error("callback ack failed", e); }
    }

    if (createdLobby) {
      // Avoid duplicating the initial lobby announcement when /game was refused.
      try {
        await this.send(chat.id,
          `🎮 فُتح التسجيل للعبة آخر حرف!\n👑 صاحب الجولة: ${display(from)} (مسجل تلقائيًا)\n👥 اضغط الزر للانضمام.\nعند الجاهزية يكتب صاحب الجولة /startgame.\n⏳ لكل لاعب 15 ثانية و3 حيوات.\n🏆 الفائز يأخذ 10 نقاط تُحفظ بين الجولات.`,
          { reply_markup: { inline_keyboard: [[{ text: "✋ انضمام للجولة", callback_data: "join" }]] } }
        );
      } catch (e) { console.error(e); }
    }
    await this.notify(chat.id, texts);
    return new Response("OK");
  }
}
