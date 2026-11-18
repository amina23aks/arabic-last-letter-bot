const startGroup = { command: "start", description: "فتح التسجيل لجولة جديدة" };
const myPoints = { command: "mypoints", description: "عرض نقاطي" };
const leaderboard = { command: "playerpointendtostartgame", description: "ترتيب نقاط اللاعبين" };
const helpCommand = { command: "help", description: "شرح اللعبة والأوامر" };

export const groupCommands = [startGroup, myPoints, leaderboard, helpCommand];
export const privateCommands = [
  { command: "start", description: "الترحيب" },
  myPoints,
  helpCommand,
];

export const welcome = "أهلًا بك في لعبة آخر حرف! أضف البوت إلى مجموعة واكتب /start لفتح التسجيل. استخدم /help لمعرفة طريقة اللعب.";

export const help = [
  "اكتب /start في المجموعة لفتح التسجيل لمدة 120 ثانية، ثم اضغط «انضمام للجولة» للمشاركة. يمكن لصاحب الجولة أو مشرف المجموعة الضغط على «بدء الجولة» بعد تسجيل لاعبين على الأقل، وإلا يبدأ اللعب تلقائيًا عند انتهاء التسجيل إذا اكتمل العدد.",
  "لكل دور 15 ثانية، ولكل لاعب 3 فرص. يبدأ اللاعب الأول بأي كلمة عربية صالحة. يجب أن تبدأ كل كلمة بآخر حرف من الكلمة السابقة، ويُمنع تكرار الكلمات.",
  "عند انتهاء الوقت تُخصم فرصة. يخرج اللاعب عند نفاد فرصه، ويفوز آخر لاعب يبقى بـ10 نقاط.",
  "/mypoints — عرض نقاطي\n/playerpointendtostartgame — ترتيب نقاط اللاعبين في المجموعة",
].join("\n\n");

export function parseCommand(text) {
  const match = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
  return match && {
    name: match[1].toLowerCase(),
    addressedHere: !match[2] || match[2].toLowerCase() === "endtostartbot",
  };
}
