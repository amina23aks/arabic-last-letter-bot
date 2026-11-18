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
    for (const [type, commands] of [
      ["all_group_chats", groupCommands],
      ["all_chat_administrators", groupCommands],
      ["all_private_chats", privateCommands],
    ]) {
      const registered = await telegram(token, "setMyCommands", { scope: { type }, commands });
      if (registered !== true) throw new Error("Registration was rejected");
    }
    console.log("Registered @EndToStartBot menus: 4 group commands (including administrators) and 3 private commands.");
  } catch {
    console.error("Registration failed. Check that the token belongs to EndToStartBot and that api.telegram.org is reachable.");
    process.exitCode = 1;
  }
}
