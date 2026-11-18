const helpCommand = { command: "help", description: "شرح اللعبة وقواعدها" };
const pointsCommand = { command: "mypoints", description: "عرض نقاطي" };

export const groupCommands = [
  { command: "start", description: "بدء جولة جديدة" },
  pointsCommand,
  { command: "leaderboard", description: "ترتيب اللاعبين" },
  helpCommand,
];

export const privateCommands = [
  { command: "start", description: "الترحيب" },
  pointsCommand,
  helpCommand,
];

export const welcome = "أهلًا بك في لعبة آخر حرف! اكتب /start في أي مجموعة أُضيف إليها البوت لفتح التسجيل. استخدم /help لمعرفة طريقة اللعب.";

export const help = [
  "اكتب /start في المجموعة لفتح التسجيل لمدة 120 ثانية، ثم اضغط «انضمام للجولة» للمشاركة. يمكن لصاحب الجولة أو مشرف المجموعة الضغط على «بدء الجولة» بعد تسجيل لاعبين على الأقل، وإلا يبدأ اللعب تلقائيًا عند انتهاء التسجيل إذا اكتمل العدد.",
  "لكل دور 15 ثانية، ولكل لاعب 3 فرص. يبدأ اللاعب الأول بأي كلمة عربية صالحة. يجب أن تبدأ كل كلمة بآخر حرف من الكلمة السابقة، ويُمنع تكرار الكلمات.",
  "عند انتهاء الوقت تُخصم فرصة. يخرج اللاعب عند نفاد فرصه، ويفوز آخر لاعب يبقى بـ10 نقاط.",
  "/mypoints — عرض نقاطك. في الخاص، يظهر رصيد كل مجموعة مرتبطة بحسابك على حدة.\n/leaderboard — ترتيب اللاعبين في المجموعة.\n/help — شرح اللعبة وقواعدها.",
].join("\n\n");

export function parseCommand(text) {
  const match = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
  return match && {
    name: match[1].toLowerCase(),
    addressedHere: !match[2] || match[2].toLowerCase() === "endtostartbot",
  };
}
