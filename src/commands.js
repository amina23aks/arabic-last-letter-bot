const helpCommand = { command: "help", description: "شرح اللعبة والأوامر" };

const pointsCommand = { command: "mypoints", description: "عرض نقاطي في المجموعة" };
const startCommand = { command: "start", description: "الترحيب" };
const rulesCommand = { command: "rules", description: "قواعد اللعبة" };

export const groupCommands = [
  { command: "start", description: "فتح التسجيل لجولة جديدة" },
  { command: "game", description: "فتح التسجيل لجولة جديدة" },
  pointsCommand,
  { command: "leaderboard", description: "ترتيب نقاط اللاعبين" },
  helpCommand,
  { command: "startgame", description: "بدء الجولة بعد تسجيل لاعبين" },
  { command: "cancelgame", description: "إلغاء التسجيل أو الجولة" },
  { command: "players", description: "عرض المشاركين والفرص" },
  { command: "status", description: "عرض حالة الجولة" },
  { command: "points", description: pointsCommand.description },
  { command: "playerpointendtostartgame", description: "ترتيب نقاط اللاعبين" },
  { command: "top", description: "ترتيب نقاط اللاعبين" },
  rulesCommand,
];
export const privateCommands = [
  startCommand,
  pointsCommand,
  helpCommand,
  { command: "points", description: pointsCommand.description },
  rulesCommand,
];

export const welcome = "أهلًا بك في لعبة آخر حرف! اكتب /game في أي مجموعة أُضيف إليها البوت لفتح التسجيل. استخدم /help لمعرفة طريقة اللعب.";

export const help = [
  "اكتب /start أو /game في المجموعة لفتح التسجيل لمدة 120 ثانية، ثم اضغط «انضمام للجولة» للمشاركة. يمكن لصاحب الجولة أو مشرف المجموعة الضغط على «بدء الجولة» بعد تسجيل لاعبين على الأقل، وإلا يبدأ اللعب تلقائيًا عند انتهاء التسجيل إذا اكتمل العدد.",
  "لكل دور 15 ثانية، ولكل لاعب 3 فرص. يبدأ اللاعب الأول بأي كلمة عربية صالحة. يجب أن تبدأ كل كلمة بآخر حرف من الكلمة السابقة، ويُمنع تكرار الكلمات.",
  "عند انتهاء الوقت تُخصم فرصة. يخرج اللاعب عند نفاد فرصه، ويفوز آخر لاعب يبقى بـ10 نقاط.",
  "/mypoints أو /points — عرض نقاطي في المجموعة\n/leaderboard أو /playerpointendtostartgame أو /top — ترتيب نقاط المجموعة",
  "/startgame — بدء مبكر بأمر صاحب الجولة أو مشرف المجموعة\n/cancelgame — إلغاء الجولة بالصلاحيات نفسها\n/players — المشاركون والفرص\n/status — حالة الجولة\n/help أو /rules — قواعد اللعبة",
].join("\n\n");

export function parseCommand(text) {
  const match = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
  return match && {
    name: match[1].toLowerCase(),
    addressedHere: !match[2] || match[2].toLowerCase() === "endtostartbot",
  };
}
