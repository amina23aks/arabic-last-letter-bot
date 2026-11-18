import assert from "node:assert/strict";
import test from "node:test";
import worker, { lifeIcons, WordGame } from "./src/index.js";

const chat = { id: -987, type: "supergroup" };
const host = { id: 10, first_name: "آمنة", username: "mefxyou" };
const second = { id: 20, first_name: "صنارة", last_name: "صيد <>&", username: "second_account" };
const admin = { id: 30, first_name: "محمد" };
const env = { BOT_TOKEN: "123:test-token", WEBHOOK_SECRET: "test-webhook" };

class Storage {
  data = new Map();
  alarmAt = null;

  async get(key) { return structuredClone(this.data.get(key)); }

  async put(key, value) { this.data.set(key, structuredClone(value)); }

  async list({ prefix }) {
    return new Map([...this.data].filter(([key]) => key.startsWith(prefix)));
  }

  async delete(key) { this.data.delete(key); }

  async setAlarm(time) { this.alarmAt = time; }

  async deleteAlarm() { this.alarmAt = null; }

  async transaction(action) {
    const transaction = new Storage();
    transaction.data = structuredClone(this.data);
    transaction.alarmAt = this.alarmAt;
    const result = await action(transaction);
    this.data = transaction.data;
    this.alarmAt = transaction.alarmAt;
    return result;
  }
}

function fixture(t, overrides = {}) {
  const config = { ...env, ...overrides };
  const storage = new Storage();
  const calls = [];
  let telegramFailure;
  let now = 1_800_000_000_000;
  let updateId = 0;
  let messageId = 0;
  const objects = new Map();
  const bindings = {
    idFromName: String,
    get(id) {
      if (!objects.has(id)) objects.set(id, new WordGame({ storage: new Storage() }, config));
      return objects.get(id);
    },
  };
  config.GAMES = bindings;
  let object = new WordGame({ storage }, config);
  objects.set(String(chat.id), object);
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, ...body });
    if (telegramFailure) return telegramFailure(method, body);
    const result = method === "getChatMember"
      ? { status: body.user_id === admin.id ? "administrator" : "member" }
      : { message_id: ++messageId };
    return Response.json({ ok: true, result });
  });

  function dispatch(update, id = ++updateId) {
    return object.fetch(new Request("https://internal/update", {
      method: "POST",
      body: JSON.stringify({ update_id: id, ...update }),
    }));
  }

  function msg(text, from = host, date = Math.floor(now / 1000), id) {
    return dispatch({ message: { chat, from, text, date } }, id);
  }

  function callback(data, from = second, id = messageId) {
    return dispatch({ callback_query: { id: `callback-${updateId}`, from, data, message: { chat, message_id: id } } });
  }

  const last = (method = "sendMessage") => calls.findLast(call => call.method === method);
  const game = () => storage.get("game");
  const alarm = () => object.alarm();
  const at = (time) => { now = time; };
  const expire = async () => {
    at((await game()).deadline);
    await alarm();
  };
  const open = async () => {
    await msg("/game");
    return last().reply_markup.inline_keyboard[0].map(button => button.callback_data);
  };
  function webhook(update, routing = bindings) {
    return worker.fetch(new Request("https://worker/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET },
      body: JSON.stringify(update),
    }), { ...config, GAMES: routing });
  }

  const restart = () => {
    for (const [id, instance] of objects) {
      objects.set(id, new WordGame({ storage: instance.ctx.storage }, config));
    }
    object = objects.get(String(chat.id));
  };
  return { dispatch, storage, calls, game, webhook, bindings, failTelegram: handler => { telegramFailure = handler; }, msg, callback, open, at, alarm, expire, last, restart, now: () => now };
}

test("registration deadline, buttons, edits, duplicate joins and cancellation", async t => {
  const f = fixture(t);
  const [join, start] = await f.open();
  const game = await f.game();
  assert.equal(game.deadline, f.now() + 120_000);
  assert.equal(f.storage.alarmAt, game.deadline);
  assert.match(f.last().text, /عدد المسجلين: 1/);
  assert.deepEqual(f.last().reply_markup.inline_keyboard[0].map(button => button.text),
    ["انضمام للجولة", "بدء الجولة"]);
  await f.callback(start, host);
  assert.match(f.last("answerCallbackQuery").text, /لاعبين اثنين/);
  await f.callback(join);
  assert.match(f.last("editMessageText").text, /عدد المسجلين: 2/);
  const oldMessage = game.lobbyMessageId;
  assert.equal(f.last("editMessageText").message_id, oldMessage);
  await f.callback(join, second, oldMessage);
  assert.match(f.last("answerCallbackQuery").text, /من قبل/);
  assert.equal((await f.game()).players.length, 2);
  assert.equal((await f.game()).deadline, game.deadline);
  await f.msg("/cancelgame", second);
  assert.equal((await f.game()).phase, "lobby");
  await f.msg("/cancelgame", admin);
  assert.equal((await f.game()).phase, "idle");
  assert.equal(f.storage.alarmAt, null);
  assert.deepEqual(f.last("editMessageReplyMarkup").reply_markup.inline_keyboard, []);
  await f.open();
  await f.callback(join, second, oldMessage);
  assert.equal((await f.game()).players.length, 1);
});

test("host and admin can start with the button, while the old command gives instructions", async t => {
  const f = fixture(t);
  const [join, start] = await f.open();
  await f.callback(join);
  await f.callback(start);
  assert.match(f.last("answerCallbackQuery").text, /مشرف/);
  await f.msg("/startgame", second);
  assert.match(f.last().text, /اضغط «بدء الجولة»/);
  await f.msg("/startgame@OtherBot");
  assert.equal((await f.game()).phase, "lobby");
  await f.msg("/startgame@EndToStartBot");
  assert.equal((await f.game()).phase, "lobby");
  await f.callback(start, host);
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.storage.alarmAt, f.now() + 15_000);
  assert.ok(f.calls.some(call => call.text?.includes("صنارة صيد &lt;&gt;&amp; — 💚💚💚")));
  assert.ok(!f.calls.some(call => call.text?.includes("second_account")));
  await f.msg("/cancelgame");
  assert.equal((await f.game()).phase, "idle");
  const [newJoin, newStart] = await f.open();
  await f.callback(newJoin);
  await f.callback(newStart, admin);
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.last("answerCallbackQuery").text, "بدأت الجولة.");
});

test("registration auto-cancels with one player and auto-starts once at the deadline", async t => {
  const f = fixture(t);
  await f.open();
  f.restart();
  await f.expire();
  assert.equal((await f.game()).phase, "idle");
  assert.match(f.last().text, /لعدم تسجيل لاعبين/);
  const [join, start] = await f.open();
  await f.callback(join);
  const deadline = (await f.game()).deadline;
  f.at(deadline - 1);
  await f.alarm();
  assert.equal((await f.game()).phase, "lobby");
  f.at(deadline);
  await Promise.all([f.callback(start, host), f.alarm(), f.msg("/startgame")]);
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.storage.alarmAt, deadline + 15_000);
  assert.equal(f.calls.filter(call => call.text?.startsWith("بدأت الجولة!")).length, 1);
  assert.equal(f.calls.filter(call => call.method === "editMessageReplyMarkup").length, 2);
});

test("life icons render three positions for every chance count", () => {
  assert.deepEqual([0, 1, 2, 3].map(lifeIcons), ["🕊️🕊️🕊️", "💚🕊️🕊️", "💚💚🕊️", "💚💚💚"]);
});

test("Arabic normalization, turn ownership, wrong letter and repeat handling", async t => {
  const f = fixture(t);
  const [join, start] = await f.open();
  await f.callback(join);
  await f.callback(start, host);
  const [first, next] = (await f.game()).players.map(player => player.id === host.id ? host : second);
  await f.msg("أب", next);
  assert.deepEqual((await f.game()).used, []);
  const before = f.calls.length;
  await f.msg("أَب", first);
  assert.deepEqual((await f.game()).used, ["اب"]);
  assert.equal(f.calls.length, before + 1);
  assert.match(f.last().text, /اكتب كلمة تبدأ بحرف: <b>ب<\/b>/);
  assert.equal(f.last().parse_mode, "HTML");
  const name = next.id === host.id ? "آمنة" : "صنارة صيد &lt;&gt;&amp;";
  assert.equal(f.last().text, `دور ${name}!\n\nاكتب كلمة تبدأ بحرف: <b>ب</b>\n\n⏳ الوقت المتبقي: 15 ثانية\n\nالفرص: 💚💚💚 (3/3)`);
  await f.msg("قلم", next);
  assert.ok(f.last().text.includes("«<b>ب</b>»"));
  assert.equal(f.last().parse_mode, "HTML");
  await f.msg("بَدَأ", next);
  assert.deepEqual((await f.game()).used, ["اب", "بدا"]);
  await f.msg("إب", first);
  assert.match(f.last().text, /استُعملت من قبل/);
  assert.equal((await f.game()).used.length, 2);
});

test("timeouts, replay, scoring, aliases, and legacy scores survive recreation", async t => {
  const f = fixture(t);
  await f.storage.put("scores", {
    10: { user_id: 10, name: "اسم سابق (@host_account)", points: 40, wins: 4 },
    20: { user_id: 20, name: "صنارة (@second_account)", points: 20, wins: 2 },
    99: { user_id: 99, name: "قديم (@old_account)", points: 70, wins: 7 },
  });
  const [join, start] = await f.open();
  await f.callback(join);
  await f.callback(start, host);
  let game = await f.game();
  const first = game.players[0].id === host.id ? host : second;
  f.at(game.deadline);
  const lateDate = Math.floor(f.now() / 1000) - 1;
  await Promise.all([f.msg("أب", first, lateDate, 999), f.alarm()]);
  await f.msg("أب", first, lateDate, 999);
  assert.deepEqual((await f.game()).players.map(player => player.lives), [2, 3]);
  assert.deepEqual((await f.game()).used, []);
  f.restart();
  for (let turn = 0; turn < 4; turn++) await f.expire();
  game = await f.game();
  assert.equal(game.phase, "idle");
  const [loser, winner] = game.players;
  assert.equal(loser.lives, 0);
  assert.equal(winner.lives, 1);
  assert.match(f.last().text, /🏁 انتهت الجولة!\n\n🏆 الفائز: .*\n\n🎁 \+10 نقاط للفائز/);
  assert.match(f.last().text, /🕊️🕊️🕊️[\s\S]*💚🕊️🕊️/);
  assert.doesNotMatch(f.last().text, /❤️|🤍|🖤/);
  const [award] = await f.storage.get("rewardEvents");
  assert.equal(award.user_id, winner.id);
  assert.equal(award.points, 10);

  // Simulate retrying the same pending award after the object has restarted.
  await new WordGame({ storage: f.storage }, env).save({ ...game, pendingReward: award });
  assert.equal((await f.storage.get("rewardEvents")).length, 1);
  const scores = await f.storage.get("scores");
  assert.equal(scores[winner.id].points, (winner.id === host.id ? 40 : 20) + 10);
  assert.equal(scores[loser.id].points, loser.id === host.id ? 40 : 20);
  f.restart();
  await f.open();
  const user = winner.id === host.id ? host : second;
  await f.msg("/mypoints@EndToStartBot", user);
  const points = f.last().text;
  assert.ok(points.includes(`${scores[user.id].points} نقطة`));
  assert.ok(points.includes(`مرات الفوز: ${scores[user.id].wins}`));
  await f.msg("/points", user);
  assert.equal(f.last().text, points);
  await f.msg("/playerpointendtostartgame");
  assert.match(f.last().text, /1\. قديم: 70 نقطة/);
  assert.doesNotMatch(f.last().text, /@old_account/);
  const leaderboard = f.last().text;
  await f.msg("/leaderboard");
  assert.equal(f.last().text, leaderboard);
  const object = new WordGame({ storage: f.storage }, env);
  const response = await object.fetch(new Request("https://internal/api/scores"));
  assert.equal((await response.json()).data.find(row => row.user_id === winner.id).points, scores[winner.id].points);
});

test("webhook routes group /start, registers the host, and updates the player list", async t => {
  const f = fixture(t);
  const routeNames = [];
  const dispatch = (text, update_id) => f.webhook({ update_id, message: { chat, from: host, text } }, {
    idFromName(name) { routeNames.push(name); return name; },
    get(id) {
      assert.equal(id, String(chat.id));
      return f.bindings.get(id);
    },
  });

  await dispatch("/start@OtherBot", 100);
  assert.equal(await f.game(), undefined);
  assert.equal((await dispatch("/start@EndToStartBot", 101)).status, 200);
  const lobby = await f.game();
  assert.equal(lobby.hostId, host.id);
  assert.deepEqual(lobby.players.map(player => player.id), [host.id]);
  assert.equal(lobby.deadline, f.now() + 120_000);
  assert.match(f.last().text, /1\. آمنة/);
  const [join, start] = f.last().reply_markup.inline_keyboard[0].map(button => button.callback_data);
  const beforeReplay = f.calls.length;
  await dispatch("/start@EndToStartBot", 101);
  assert.equal(f.calls.length, beforeReplay);
  await dispatch("/start", 102);
  assert.match(f.last().text, /بالفعل/);
  assert.equal((await f.game()).roundId, lobby.roundId);
  await f.callback(join, second, lobby.lobbyMessageId);
  assert.match(f.last("editMessageText").text, /2\. صنارة صيد <>&/);
  await f.callback(start, host, lobby.lobbyMessageId);
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.storage.alarmAt, f.now() + 15_000);
  assert.match(f.last().text, /أي كلمة عربية صالحة/);
  assert.deepEqual(routeNames, Array(4).fill(String(chat.id)));
});

test("private points read only the caller's current balances from indexed groups", async t => {
  const f = fixture(t);
  const primary = { ...chat, title: "مجموعة <أ>" };
  const other = { id: -123, type: "group", title: "مجموعة ب" };
  const privateMessage = (text, from = host) => f.webhook({
    message: { chat: { id: from.id, type: "private" }, from, text },
  });
  const groupMessage = (chat, text, from = host) => f.webhook({ message: { chat, from, text } });
  await privateMessage("/start");
  assert.match(f.last().text, /أهلًا بك/);
  await privateMessage("/help");
  assert.match(f.last().text, /120 ثانية[\s\S]*15 ثانية[\s\S]*3 فرص[\s\S]*10 نقاط/);

  const oldScores = {
    10: { user_id: host.id, name: host.first_name, points: 40, wins: 4 },
    20: { user_id: second.id, name: second.first_name, points: 90, wins: 9 },
  };
  await f.storage.put("scores", oldScores);
  await privateMessage("/mypoints");
  assert.match(f.last().text, /لا توجد مجموعات/);
  await groupMessage(primary, "/mypoints@EndToStartBot");
  assert.match(f.last().text, /40 نقطة\nمرات الفوز: 4/);

  f.restart();
  await privateMessage("/mypoints");
  assert.equal(f.last().chat_id, host.id);
  assert.equal(f.last().text, "📊 نقاطك\n\n👤 آمنة: 40 نقطة\n\n🏆 مرات الفوز: 4");
  await privateMessage("/mypoints 10", second);
  assert.match(f.last().text, /لا توجد مجموعات/);

  await groupMessage(other, "/start");
  await privateMessage("/mypoints");
  assert.equal(f.last().text, "📊 نقاطك\n\n👤 آمنة: 40 نقطة\n\n🏆 مرات الفوز: 4");
  const otherStorage = f.bindings.get(String(other.id)).ctx.storage;
  await otherStorage.put("scores", { 10: { ...oldScores[10], points: 70, wins: 7 } });
  await privateMessage("/mypoints");
  assert.equal(f.last().text, "📊 نقاطك\n\n👤 آمنة: 70 نقطة\n\n🏆 مرات الفوز: 7");
  assert.doesNotMatch(f.last().text, /90 نقطة|110 نقطة/);
  assert.deepEqual(await f.storage.get("scores"), oldScores);
});

test("a failed lobby message is logged safely and the same webhook can retry", async t => {
  const f = fixture(t);
  const error = t.mock.method(console, "error", () => {});
  const update = { update_id: 100, message: { chat, from: host, text: "/start" } };
  f.failTelegram(() => Response.json({
    ok: false, error_code: 403, description: `Sensitive: ${env.BOT_TOKEN}`,
  }, { status: 403 }));
  assert.equal((await f.webhook(update)).status, 500);
  assert.equal(await f.game(), undefined);
  assert.equal(f.storage.alarmAt, null);
  assert.deepEqual(error.mock.calls[0].arguments[1], {
    message: "Telegram sendMessage failed", status: 403, telegramCode: 403,
  });
  f.failTelegram(null);
  assert.equal((await f.webhook(update)).status, 200);
  assert.equal((await f.game()).phase, "lobby");
});

test("registration script replaces the scoped command lists on repeated runs", async t => {
  const token = process.env.BOT_TOKEN;
  const requests = [];
  process.env.BOT_TOKEN = env.BOT_TOKEN;
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    requests.push([method, JSON.parse(options.body)]);
    return Response.json({ ok: true, result: method === "getMe" ? { username: "EndToStartBot" } : true });
  });
  try {
    await import("./scripts/register-commands.mjs?first");
    await import("./scripts/register-commands.mjs?second");
  } finally {
    if (token === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = token;
  }
  assert.deepEqual(requests.slice(0, 5), requests.slice(5));
  assert.equal(requests[0][0], "getMe");
  assert.deepEqual(requests[4], ["deleteMyCommands", { scope: { type: "default" } }]);
  const group = ["start", "mypoints", "leaderboard", "help"];
  const expected = {
    all_group_chats: group,
    all_chat_administrators: group,
    all_private_chats: ["start", "mypoints", "help"],
  };
  for (const [method, registration] of requests.slice(1, 4)) {
    assert.equal(method, "setMyCommands");
    assert.deepEqual(registration.commands.map(entry => entry.command), expected[registration.scope.type]);
    assert.ok(registration.commands.every(entry => /\p{Script=Arabic}/u.test(entry.description)));
  }
});

test("an existing untimed lobby can use its old join button after upgrade", async t => {
  const f = fixture(t);
  await f.storage.put("game", {
    phase: "lobby",
    hostId: host.id,
    players: [{ id: host.id, name: "آمنة (@host_account)", lives: 3 }],
    roundId: "previous-round",
    deadline: null,
    recentUpdates: [],
  });
  await f.callback("join", second, 90);
  assert.equal((await f.game()).deadline, f.now() + 120_000);
  assert.equal(f.last("editMessageText").message_id, 90);
  assert.match(f.last("editMessageText").text, /عدد المسجلين: 2/);
  assert.doesNotMatch(f.last("editMessageText").text, /@host_account/);
  const start = f.last("editMessageText").reply_markup.inline_keyboard[0][1].callback_data;
  await f.callback(start, host);
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.last("editMessageReplyMarkup").message_id, 90);
});

test("registration rejects a wrong bot and keeps token-bearing errors private", async t => {
  const token = process.env.BOT_TOKEN;
  const exitCode = process.exitCode;
  const methods = [];
  const error = t.mock.method(console, "error", () => {});
  process.env.BOT_TOKEN = env.BOT_TOKEN;
  t.mock.method(globalThis, "fetch", async url => {
    methods.push(new URL(url).pathname.split("/").at(-1));
    if (methods.length === 2) throw new Error(`Failed to request ${url}`);
    return Response.json({ ok: true, result: { username: "OtherBot" } });
  });
  try {
    await import("./scripts/register-commands.mjs?wrong-bot");
    assert.equal(process.exitCode, 1);
    await import("./scripts/register-commands.mjs?failed-network");
    assert.equal(process.exitCode, 1);
  } finally {
    if (token === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = token;
    process.exitCode = exitCode;
  }
  assert.deepEqual(methods, ["getMe", "getMe"]);
  assert.equal(error.mock.callCount(), 2);
  assert.ok(error.mock.calls.every(call => !call.arguments[0].includes(env.BOT_TOKEN)));
});

test("a new group can open and join a round without approval", async t => {
  const f = fixture(t);
  const newChat = { id: -654, type: "group" };
  const membership = {
    chat: newChat, from: host, old_chat_member: { status: "left" },
    new_chat_member: { status: "member" },
  };
  assert.equal((await f.webhook({ my_chat_member: membership })).status, 200);
  assert.equal(f.calls.length, 0);

  for (const [update_id, text, expected] of [
    [100, "/help", /120 ثانية/],
    [101, "/leaderboard", /لا يوجد رصيد/],
    [102, "/game", /فُتح التسجيل/],
  ]) {
    const response = await f.webhook({ update_id, message: { chat: newChat, from: host, text } });
    assert.equal(response.status, 200);
    assert.equal(f.last().chat_id, newChat.id);
    assert.match(f.last().text, expected);
  }
  const object = f.bindings.get(String(newChat.id));
  const lobby = await object.ctx.storage.get("game");
  const join = f.last().reply_markup.inline_keyboard[0][0].callback_data;
  await f.webhook({ update_id: 103, callback_query: {
    id: "join", from: second, data: join, message: { chat: newChat, message_id: lobby.lobbyMessageId },
  } });
  assert.deepEqual((await object.ctx.storage.get("game")).players.map(({ id }) => id), [host.id, second.id]);
  f.at(lobby.deadline);
  await object.alarm();
  assert.equal((await object.ctx.storage.get("game")).phase, "playing");
  assert.equal(object.ctx.storage.alarmAt, f.now() + 15_000);
});

test("retired score commands and old reset buttons leave stored scores intact", async t => {
  const f = fixture(t, { ADMIN_USER_IDS: "101,102,103", APPROVED_GROUP_IDS: String(chat.id) });
  const formerOwner = { id: 101, first_name: "مالك" };
  const scores = { 10: { user_id: host.id, name: host.first_name, points: 100, wins: 3 } };
  const pendingReset = { token: "old-confirmation", targetId: host.id, expiresAt: f.now() + 60_000 };
  await f.storage.put("scores", scores);
  await f.storage.put("scoreReset:101", pendingReset);

  for (const from of [second, formerOwner]) {
    for (const text of ["/addpoints 7", "/removepoints 7", "/setpoints 7", "/resetpoints"]) {
      await f.dispatch({ message: { chat, from, text, reply_to_message: { from: host } } });
      assert.match(f.last().text, /تعديل النقاط معطّل/);
    }
  }
  await f.callback("resetpoints:old-confirmation", formerOwner);
  assert.match(f.last("answerCallbackQuery").text, /تعديل النقاط معطّل/);
  assert.deepEqual(await f.storage.get("scores"), scores);
  assert.deepEqual(await f.storage.get("scoreReset:101"), pendingReset);
});

function privateAdmin(f, from = host) {
  const chat = { id: from.id, type: "private" };
  const messageId = 100;
  let callbackId = 0;
  return {
    send: text => f.webhook({ message: { chat, from, text } }),
    buttons: () => (f.last("editMessageText") || f.last()).reply_markup.inline_keyboard.flat(),
    click: (data, actor = from, target = chat) => f.webhook({
      callback_query: {
        id: String(++callbackId), from: actor, data,
        message: { chat: target, message_id: messageId },
      },
    }),
  };
}

test("username owner authorization allows only three configured usernames in private", async t => {
  const f = fixture(t);
  for (const username of ["mefxyou", "Am23zu8", "i_lovezizi"]) {
    const owner = { id: username === "mefxyou" ? 10 : username === "Am23zu8" ? 21 : 22, username };
    const menu = privateAdmin(f, owner);
    await menu.send("/managepoints");
    assert.doesNotMatch(f.last().text, /غير متاحة/);
  }
  for (const username of ["other_user", "mefxyou_fake", undefined]) {
    const person = { id: 98, username };
    const menu = privateAdmin(f, person);
    await menu.send("/managepoints");
    assert.match(f.last().text, /غير متاحة/);
    await menu.click("mp:fake:apply");
    assert.match(f.last("answerCallbackQuery").text, /غير متاحة/);
  }
  const forgedGroup = privateAdmin(f, { id: 10, username: "mefxyou" });
  await forgedGroup.click("mp:fake:apply", { id: 10, username: "mefxyou" }, chat);
  assert.match(f.last("answerCallbackQuery").text, /غير متاحة/);
});

test("private management reads stored players and atomically applies individual changes", async t => {
  const f = fixture(t, { POINTS_OWNER_IDS: "10,20,30" });
  const outsider = { id: 99, username: "other_user" };
  const existing = {
    20: { user_id: 20, name: "لاعب قديم (@old_name)", points: 20, wins: 2 },
    99: { user_id: 99, name: "لاعب آخر", points: 50, wins: 5 },
  };
  await f.storage.put("scores", existing);
  await privateAdmin(f, outsider).send("/managepoints");
  assert.match(f.last().text, /غير متاحة/);
  assert.equal(f.last().reply_markup, undefined);
  await f.msg("/managepoints");
  assert.equal(f.last().chat_id, outsider.id);

  // A historical group becomes selectable even if the owner has never played there.
  await f.msg("/leaderboard");
  const menu = privateAdmin(f);
  await menu.send("/managepoints");
  const groupButton = f.last().reply_markup.inline_keyboard[0][0].callback_data;
  await menu.click(groupButton, outsider);
  assert.match(f.last("answerCallbackQuery").text, /غير متاحة/);
  await menu.click(groupButton, host, chat);
  assert.match(f.last("answerCallbackQuery").text, /غير متاحة/);
  await menu.click(groupButton);

  const choosePlayer = async () => {
    const btn = menu.buttons().find(button => button.text.endsWith("(20)"));
    assert.ok(btn);
    assert.doesNotMatch(btn.text, /@old_name/);
    assert.ok(Buffer.byteLength(btn.callback_data) <= 64);
    await menu.click(btn.callback_data);
  };
  const press = label => menu.click(menu.buttons().find(button => button.text === label).callback_data);
  await choosePlayer();
  assert.match(f.last("editMessageText").text, /20 نقطة، مرات الفوز: 2/);
  await press("تصفير النقاط مع إبقاء مرات الفوز");
  const confirm = menu.buttons().find(button => button.text === "تأكيد").callback_data;
  await menu.click(confirm, second, { id: second.id, type: "private" });
  assert.match(f.last("answerCallbackQuery").text, /انتهت صلاحية/);
  assert.deepEqual(await f.storage.get("scores"), existing);

  // A Telegram failure after the commit leaves the same confirmation retryable.
  const log = t.mock.method(console, "error", () => {});
  f.failTelegram(method => Response.json(
    method === "editMessageText" ? { ok: false, error_code: 503 } : { ok: true, result: true },
    { status: method === "editMessageText" ? 503 : 200 },
  ));
  assert.equal((await menu.click(confirm)).status, 500);
  assert.equal(log.mock.callCount(), 1);
  f.failTelegram(null);
  f.restart();
  const retryResponses = await Promise.all([menu.click(confirm), menu.click(confirm)]);
  assert.ok(retryResponses.every(response => response.status === 200));
  assert.deepEqual((await f.storage.get("scores"))[20], { ...existing[20], points: 0 });
  const firstAudit = [...(await f.storage.list({ prefix: "pointsAdminAudit:" })).values()];
  assert.equal(firstAudit.length, 1);
  assert.deepEqual(firstAudit[0].before, { points: 20, wins: 2 });
  assert.deepEqual(firstAudit[0].after, { points: 0, wins: 2 });
  assert.equal(firstAudit[0].actor, host.id);
  assert.equal(firstAudit[0].groupId, chat.id);

  async function reopen() {
    await menu.send("/managepoints");
    await menu.click(f.last().reply_markup.inline_keyboard[0][0].callback_data);
    await choosePlayer();
  }
  await reopen();
  await press("إضافة نقاط");
  await menu.send("17");
  const addConfirmation = menu.buttons().find(button => button.text === "تأكيد").callback_data;
  await Promise.all([menu.click(addConfirmation), menu.click(addConfirmation)]);
  assert.equal((await f.storage.get("scores"))[20].points, 17);
  await reopen();
  assert.match(f.last("editMessageText").text, /17 نقطة، مرات الفوز: 2/);
  await press("خصم نقاط");
  await press("5");
  await press("تأكيد");
  await reopen();
  assert.match(f.last("editMessageText").text, /12 نقطة، مرات الفوز: 2/);
  await press("تصفير النقاط ومرات الفوز");
  const expired = menu.buttons().find(button => button.text === "تأكيد").callback_data;
  f.at(f.now() + 300_000);
  await menu.click(expired);
  assert.equal((await f.storage.get("scores"))[20].wins, 2);

  await reopen();
  await press("تصفير النقاط ومرات الفوز");
  const current = await f.storage.get("scores");
  current[20].points += 10;
  current[20].wins += 1;
  await f.storage.put("scores", current);
  await press("تأكيد");
  assert.match(f.last("editMessageText").text, /تغيّر رصيد اللاعب/);
  assert.deepEqual(await f.storage.get("scores"), current);

  await reopen();
  await press("تصفير النقاط ومرات الفوز");
  await press("تأكيد");
  const adjusted = await f.storage.get("scores");
  assert.deepEqual(adjusted[20], { ...existing[20], points: 0, wins: 0 });
  assert.deepEqual(adjusted[99], existing[99]);
  assert.equal((await f.storage.list({ prefix: "pointsAdminAudit:" })).size, 4);

  await f.msg("/leaderboard");
  assert.match(f.last().text, /لاعب قديم: 0 نقطة \(0 فوز\)/);
  await f.msg("/mypoints", second);
  assert.match(f.last().text, /0 نقطة\nمرات الفوز: 0/);
  await privateAdmin(f, second).send("/mypoints");
  assert.match(f.last().text, /0 نقطة[\s\S]*مرات الفوز: 0/);
  assert.doesNotMatch(f.last().text, /50 نقطة/);
});

test("a stale private group link does not fabricate a zero", async t => {
  const f = fixture(t);
  await f.bindings.get(`player:${host.id}`).ctx.storage.put(`scoreGroup:${chat.id}`, { id: chat.id });
  await privateAdmin(f).send("/mypoints");
  assert.match(f.last().text, /لا توجد مجموعات/);
  assert.doesNotMatch(f.last().text, /0 نقطة/);
});

test("private points report a failed group read while displaying available balances", async t => {
  const f = fixture(t);
  const playerStorage = f.bindings.get(`player:${host.id}`).ctx.storage;
  await playerStorage.put(`scoreGroup:${chat.id}`, { id: chat.id, title: "مجموعة محفوظة" });
  await playerStorage.put("scoreGroup:-999", { id: -999, title: "مجموعة متعذرة" });
  await f.storage.put("scores", { 10: { points: 20, wins: 2 } });
  const get = f.bindings.get;
  t.mock.method(f.bindings, "get", id => id === "-999"
    ? { fetch: async () => new Response(null, { status: 503 }) }
    : get(id));
  await privateAdmin(f).send("/mypoints");
  assert.match(f.last().text, /تعذّر قراءة رصيدك الآن/);
  assert.doesNotMatch(f.last().text, /مجموعة متعذرة|مجموعة محفوظة|0 نقطة/);
});
