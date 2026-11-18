const helpCommand = { command: "help", description: "شرح اللعبة والأوامر" };

export const groupCommands = [
  { command: "game", description: "فتح التسجيل لجولة جديدة" },
  { command: "startgame", description: "بدء الجولة بعد تسجيل لاعبين" },
  { command: "mypoints", description: "عرض نقاطي" },
  { command: "leaderboard", description: "ترتيب نقاط اللاعبين" },
  { command: "playerpointendtostartgame", description: "ترتيب نقاط اللاعبين" },
  { command: "rules", description: "قواعد اللعبة" },
  { command: "cancelgame", description: "إلغاء التسجيل أو الجولة" },
  helpCommand,
];
export const privateCommands = [
  { command: "start", description: "الترحيب" },
  helpCommand,
  { command: "myid", description: "عرض معرّف حسابي الرقمي" },
];

export const welcome = "أهلًا بك في لعبة آخر حرف! اكتب /game في مجموعة معتمدة لفتح التسجيل. استخدم /help لمعرفة طريقة اللعب.";

export const help = [
  "اكتب /game في المجموعة لفتح التسجيل لمدة 120 ثانية، ثم اضغط «انضمام للجولة» للمشاركة. يمكن لصاحب الجولة أو مشرف المجموعة الضغط على «بدء الجولة» بعد تسجيل لاعبين على الأقل، وإلا يبدأ اللعب تلقائيًا عند انتهاء التسجيل إذا اكتمل العدد.",
  "لكل دور 15 ثانية، ولكل لاعب 3 فرص. يبدأ اللاعب الأول بأي كلمة عربية صالحة. يجب أن تبدأ كل كلمة بآخر حرف من الكلمة السابقة، ويُمنع تكرار الكلمات.",
  "عند انتهاء الوقت تُخصم فرصة. يخرج اللاعب عند نفاد فرصه، ويفوز آخر لاعب يبقى بـ10 نقاط.",
  "/mypoints أو /points — عرض نقاطي في المجموعة\n/leaderboard أو /playerpointendtostartgame — ترتيب نقاط المجموعة",
  "/startgame — بدء مبكر بأمر صاحب الجولة أو مشرف المجموعة\n/cancelgame — إلغاء الجولة بالصلاحيات نفسها\n/rules — قواعد اللعبة\n/myid — عرض معرّف حسابك في الخاص",
].join("\n\n");

export function parseCommand(text) {
  const match = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
  return match && {
    name: match[1].toLowerCase(),
    addressedHere: !match[2] || match[2].toLowerCase() === "endtostartbot",
  };
}
