export const commands = [
  { command: "game", description: "افتح التسجيل لجولة جديدة لمدة دقيقتين" },
  { command: "startgame", description: "ابدأ الجولة مبكرًا بعد تسجيل لاعبين على الأقل" },
  { command: "mypoints", description: "اعرض رصيد نقاطك وعدد مرات فوزك" },
  { command: "points", description: "اعرض رصيد نقاطك وعدد مرات فوزك" },
  { command: "leaderboard", description: "اعرض ترتيب النقاط في المجموعة" },
  { command: "rules", description: "اعرض قواعد لعبة آخر حرف" },
  { command: "help", description: "اعرض الأوامر وطريقة اللعب" },
  { command: "cancelgame", description: "ألغِ التسجيل أو الجولة الحالية" },
  { command: "start", description: "اعرض رسالة الترحيب" },
];

export const welcome = "أهلًا بك في لعبة آخر حرف! أضف البوت إلى مجموعة واكتب /game لفتح التسجيل. استخدم /help لعرض الأوامر و/rules لمعرفة القواعد. عطّل وضع الخصوصية للبوت ليقرأ كلمات اللاعبين.";

export const rules = "تبدأ الجولة بأي كلمة عربية صالحة. على كل لاعب أن يكتب كلمة تبدأ بآخر حرف من الكلمة السابقة، دون تكرار. لكل دور 15 ثانية ولكل لاعب 3 فرص. عند انتهاء الوقت تُخصم فرصة، ويخرج اللاعب عند نفاد فرصه. آخر لاعب يبقى يفوز ويحصل على 10 نقاط محفوظة في المجموعة.";

export const help = `اكتب /game في المجموعة ثم اضغط زر الانضمام. يغلق التسجيل بعد دقيقتين.\n\n${commands.map(({ command, description }) => `/${command} — ${description}`).join("\n")}`;

export function parseCommand(text) {
  const match = /^\/(\w+)(?:@(\w+))?(?:\s|$)/.exec(text);
  return match && {
    name: match[1].toLowerCase(),
    addressedHere: !match[2] || match[2].toLowerCase() === "endtostartbot",
  };
}
