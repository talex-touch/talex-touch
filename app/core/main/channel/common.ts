import packageJson from "./../../package.json";
import { shell } from "electron";
import os from "os";
import { ChannelType } from "utils/channel";
import { genTouchChannel } from "../core/channel-core";
import { TalexTouch } from "../types";

function closeApp(app: TalexTouch.TouchApp) {
  app.window.close();

  app.app.quit();

  process.exit(0);
}

function getOSInformation() {
  return {
    arch: os.arch(),
    cpus: os.cpus(),
    endianness: os.endianness(),
    freemem: os.freemem(),
    homedir: os.homedir(),
    hostname: os.hostname(),
    loadavg: os.loadavg(),
    networkInterfaces: os.networkInterfaces(),
    platform: os.platform(),
    release: os.release(),
    tmpdir: os.tmpdir(),
    totalmem: os.totalmem(),
    type: os.type(),
    uptime: os.uptime(),
    userInfo: os.userInfo(),
    version: os.version(),
  };
}

export default {
  name: Symbol("CommonChannel"),
  listeners: new Array<Function>(),
  filePath: false,
  init(app) {
    const channel = genTouchChannel(app);

    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "close", () => closeApp(app))
    );
    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "minimize", () =>
        app.window.minimize()
      )
    );
    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "dev-tools", () => {
        console.log("[dev-tools] Open dev tools!")
        app.window.openDevTools({ mode: "undocked" });
        app.window.openDevTools({ mode: "detach" });
        app.window.openDevTools({ mode: "right" });
      })
    );
    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "get-package", () => packageJson)
    );
    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "open-external", ({ data }) =>
        shell.openExternal(data.url)
      )
    );
    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "get-os", getOSInformation)
    );

    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "common:cwd", process.cwd)
    );
  },
  destroy() {
    this.listeners.forEach((f: () => void) => f());
  },
} as TalexTouch.IModule;
