import { groupCommands, privateCommands } from "../src/commands.js";
import { telegram } from "../src/telegram.js";

const token = process.env.BOT_TOKEN;
if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error("Set BOT_TOKEN in the process environment before registering commands.");
  process.exitCode = 1;
} else {
  try {
    const bot = await telegram(token, "getMe", {});
    if (bot?.username?.toLowerCase() !== "endtostartbot") {
      throw new Error("Unexpected bot");
    }
    // Telegram cannot enumerate configured scope/language pairs.
    const obsolete = JSON.parse(process.env.OBSOLETE_COMMAND_SCOPES || "[]");
    if (!Array.isArray(obsolete) || obsolete.some(entry =>
      !entry || typeof entry.scope?.type !== "string" ||
      (!entry.language_code && ["all_group_chats", "all_chat_administrators", "all_private_chats"].includes(entry.scope.type)))) {
      throw new Error("Invalid obsolete command scopes");
    }
    for (const [type, commands] of [
      ["all_group_chats", groupCommands],
      ["all_chat_administrators", groupCommands],
      ["all_private_chats", privateCommands],
    ]) {
      const registered = await telegram(token, "setMyCommands", { scope: { type }, commands });
      if (registered !== true) throw new Error("Registration was rejected");
    }
    for (const entry of [{ scope: { type: "default" } }, ...obsolete]) {
      if (await telegram(token, "deleteMyCommands", entry) !== true) throw new Error("Cleanup was rejected");
    }
    console.log("Registered @EndToStartBot menus: 4 group commands (including administrators) and 3 private commands.");
  } catch {
    console.error("Registration failed. Check the bot token, obsolete command scopes, and Telegram connectivity.");
    process.exitCode = 1;
  }
}
