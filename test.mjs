import assert from "node:assert/strict";
import test from "node:test";
import worker, { activeHearts, finalHearts, WordGame } from "./src/index.js";

const chat = { id: -987, type: "supergroup" };
const host = { id: 10, first_name: "آمنة", username: "host_account" };
const second = { id: 20, first_name: "صنارة", last_name: "صيد <>&", username: "second_account" };
const admin = { id: 30, first_name: "محمد" };
const env = { BOT_TOKEN: "123:test-token", WEBHOOK_SECRET: "test-webhook" };

class Storage {
  data = new Map();
  alarmAt = null;

  async get(key) { return structuredClone(this.data.get(key)); }

  async put(key, value) { this.data.set(key, structuredClone(value)); }

  async setAlarm(time) { this.alarmAt = time; }

  async deleteAlarm() { this.alarmAt = null; }

  async transaction(action) {
    const transaction = new Storage();
    transaction.data = structuredClone(this.data);
    transaction.alarmAt = this.alarmAt;
    await action(transaction);
    this.data = transaction.data;
    this.alarmAt = transaction.alarmAt;
  }
}

function fixture(t) {
  const storage = new Storage();
  const calls = [];
  let telegramFailure;
  let now = 1_800_000_000_000;
  let updateId = 0;
  let messageId = 0;
  let object = new WordGame({ storage }, env);
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
  function webhook(update, bindings = { idFromName: String, get: () => object }) {
    return worker.fetch(new Request("https://worker/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.WEBHOOK_SECRET },
      body: JSON.stringify(update),
    }), { ...env, GAMES: bindings });
  }

  const restart = () => { object = new WordGame({ storage }, env); };
  return { storage, calls, game, webhook, failTelegram: handler => { telegramFailure = handler; }, msg, callback, open, at, alarm, expire, last, restart, now: () => now };
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

test("owner can start with a suffixed command and admin can start with a button", async t => {
  const f = fixture(t);
  const [join, start] = await f.open();
  await f.callback(join);
  await f.callback(start);
  assert.match(f.last("answerCallbackQuery").text, /مشرف/);
  await f.msg("/startgame", second);
  assert.match(f.last().text, /مشرف/);
  await f.msg("/startgame@OtherBot");
  assert.equal((await f.game()).phase, "lobby");
  await f.msg("/startgame@EndToStartBot");
  assert.equal((await f.game()).phase, "playing");
  assert.equal(f.storage.alarmAt, f.now() + 15_000);
  assert.ok(f.calls.some(call => call.text?.includes("صنارة صيد <>& — 💚💚💚")));
  assert.ok(!f.calls.some(call => call.text?.includes("second_account") || call.parse_mode));
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

test("heart formats render exactly three hearts for every chance count", () => {
  assert.deepEqual([0, 1, 2, 3].map(activeHearts), ["❤️❤️❤️", "💚❤️❤️", "💚💚❤️", "💚💚💚"]);
  assert.deepEqual([0, 1, 2, 3].map(finalHearts), ["🖤🖤🖤", "🤍🖤🖤", "🤍🤍🖤", "🤍🤍🤍"]);
});

test("Arabic normalization, turn ownership, wrong letter and repeat handling", async t => {
  const f = fixture(t);
  const [join] = await f.open();
  await f.callback(join);
  await f.msg("/startgame");
  const [first, next] = (await f.game()).players.map(player => player.id === host.id ? host : second);
  await f.msg("أب", next);
  assert.deepEqual((await f.game()).used, []);
  const before = f.calls.length;
  await f.msg("أَب", first);
  assert.deepEqual((await f.game()).used, ["اب"]);
  assert.equal(f.calls.length, before + 1);
  assert.match(f.last().text, /اكتب كلمة تبدأ بحرف: ب/);
  await f.msg("قلم", next);
  assert.match(f.last().text, /لازم تبدأ/);
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
  const [join] = await f.open();
  await f.callback(join);
  await f.msg("/startgame");
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
  assert.match(f.last().text, /انتهت الجولة!\n\nالفائز: .*\n\n\+10 نقاط للفائز!/);
  assert.match(f.last().text, /🖤🖤🖤[\s\S]*🤍🖤🖤/);
  assert.doesNotMatch(f.last().text, /💚|❤️/);
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
      return new WordGame({ storage: f.storage }, env);
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

test("private /start welcomes, help covers gameplay, and /mypoints reads existing scores", async t => {
  const f = fixture(t);
  const privateChat = { id: host.id, type: "private" };
  const send = (chat, text) => f.webhook({ message: { chat, from: host, text } });
  await send(privateChat, "/start");
  assert.match(f.last().text, /أهلًا بك/);
  assert.equal(f.last().chat_id, host.id);
  assert.equal(await f.game(), undefined);
  await send(privateChat, "/help");
  assert.match(f.last().text, /120 ثانية[\s\S]*15 ثانية[\s\S]*3 فرص[\s\S]*10 نقاط/);
  const privateStorage = new Storage();
  const privateScores = { 10: { user_id: host.id, name: host.first_name, points: 20, wins: 2 } };
  const groupScores = { 10: { user_id: host.id, name: host.first_name, points: 40, wins: 4 } };
  await privateStorage.put("scores", privateScores);
  await f.storage.put("scores", groupScores);
  for (const [context, scores] of [[privateChat, privateScores], [chat, groupScores]]) {
    const selected = [];
    const response = await f.webhook({ message: { chat: context, from: host, text: "/mypoints@EndToStartBot" } }, {
      idFromName(name) { selected.push(name); return name; },
      get(id) {
        const storage = id === String(privateChat.id) ? privateStorage : f.storage;
        return new WordGame({ storage }, env);
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(selected, [String(context.id)]);
    assert.equal(f.last().chat_id, context.id);
    assert.ok(f.last().text.includes(`${scores[host.id].points} نقطة\nمرات الفوز: ${scores[host.id].wins}`));
  }
  assert.deepEqual(await f.storage.get("scores"), groupScores);
  assert.deepEqual(await privateStorage.get("scores"), privateScores);
  assert.equal(await privateStorage.get("game"), undefined);
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
  assert.deepEqual(requests.slice(0, 3), requests.slice(3));
  assert.equal(requests[0][0], "getMe");
  const expected = {
    all_group_chats: ["start", "mypoints", "playerpointendtostartgame", "help"],
    all_private_chats: ["start", "mypoints", "help"],
  };
  for (const [method, registration] of requests.slice(1, 3)) {
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
  await f.msg("/startgame");
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
