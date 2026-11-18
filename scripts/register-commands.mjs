import { commands } from "../src/commands.js";
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
    const registered = await telegram(token, "setMyCommands", {
      scope: { type: "all_group_chats" },
      commands,
    });
    if (registered !== true) throw new Error("Registration was rejected");
    console.log("Registered nine Arabic commands for EndToStartBot group chats.");
  } catch {
    console.error("Registration failed. Check that the token belongs to EndToStartBot and that api.telegram.org is reachable.");
    process.exitCode = 1;
  }
}
