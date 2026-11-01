/** All English namespaces, merged. The key set is the source of truth. */
import { common } from "./common.js";
import { shell } from "./shell.js";
import { ui } from "./ui.js";
import { format } from "./format.js";
import { overview } from "./overview.js";
import { accounts } from "./accounts.js";
import { sessions } from "./sessions.js";
import { tools } from "./tools.js";
import { settings } from "./settings.js";
import { tray } from "./tray.js";
import { engines } from "./engines.js";
import { vm } from "./vm.js";

export const en = {
  ...common,
  ...shell,
  ...ui,
  ...format,
  ...overview,
  ...accounts,
  ...sessions,
  ...tools,
  ...settings,
  ...tray,
  ...engines,
  ...vm,
} as const;
