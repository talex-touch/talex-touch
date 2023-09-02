import packageJson from "./../../package.json";
import { shell } from "electron";
import os from "os";
import { ChannelType } from "@talex-touch/utils/channel";
import { genTouchChannel } from "../core/channel-core";
import { TalexTouch } from "../types";
import { TalexEvents, touchEventBus } from "../core/eventbus/touch-event";

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
        console.log("[dev-tools] Open dev tools!");
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
      channel.regChannel(ChannelType.MAIN, "get-os", () => getOSInformation())
    );

    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "common:cwd", process.cwd)
    );

    this.listeners.push(
      channel.regChannel(ChannelType.MAIN, "url:open", ({ data }) =>
        onOpenUrl(data)
      )
    );

    async function onOpenUrl(url) {
      console.log("open url", url);
      const data = await channel.send(ChannelType.MAIN, "url:open", url);

      if (data.data) {
        shell.openExternal(url);
      }
    }

    app.app.addListener("open-url", (event, url) => {
      event.preventDefault();

      onOpenUrl(url);
    });

    touchEventBus.on(TalexEvents.OPEN_EXTERNAL_URL, (event) =>
      onOpenUrl(event.data)
    );
  },
  destroy() {
    this.listeners.forEach((f: () => void) => f());
  },
} as TalexTouch.IModule;