import { IPluginFeature } from "./../../../../packages/utils/plugin/index";
import {
  IPlatform,
  IPluginDev,
  IPluginIcon,
  IPluginManager,
  IPluginWebview,
  ITouchPlugin,
  PluginStatus,
} from "@talex-touch/utils/plugin";
import {
  WebContentsProperty,
  WindowProperties,
  WindowProperty,
} from "@talex-touch/utils/plugin/sdk/window";
import { TalexTouch } from "../types";
import fse from "fs-extra";
import path from "path";
import pkg from "../../package.json";
import { genTouchChannel } from "../core/channel-core";
import { ChannelType, DataCode } from "@talex-touch/utils/channel";
import { genTouchApp, TouchWindow } from "../core/touch-core";
import { getJs, getStyles } from "../utils/plugin-injection";
import chokidar from "chokidar";
import { TalexEvents, touchEventBus } from "../core/eventbus/touch-event";
import { BrowserWindow } from "electron";
import { MicaBrowserWindow } from "talex-mica-electron";

class PluginIcon implements IPluginIcon {
  type: string;
  value: any;

  _value: string;
  constructor(rootPath: string, type: string, value: string) {
    this.type = type;
    this._value = value;

    if (this.type === "file") {
      setTimeout(async () => {
        this.value = await fse.readFileSync(path.resolve(rootPath, value));
      });
    } else this.value = this._value;
  }
}

const disallowedArrays = ["官方", "touch", "talex", "第一"];

class TouchPlugin implements ITouchPlugin {
  dev: IPluginDev;
  name: string;
  readme: string;
  version: string;
  desc: string;
  icon: IPluginIcon;
  webViewInit: boolean = false;
  webview: IPluginWebview = {};
  platforms: IPlatform;
  features: IPluginFeature[];

  pluginPath: string;

  _status: PluginStatus = PluginStatus.DISABLED;

  _windows: Map<number, TouchWindow> = new Map();

  toJSONObject() {
    return {
      name: this.name,
      readme: this.readme,
      version: this.version,
      desc: this.desc,
      icon: this.icon,
      dev: this.dev,
      webViewInit: this.webViewInit,
      webview: this.webview,
      status: this.status,
      platforms: this.platforms,
    };
  }

  get status(): PluginStatus {
    return this._status;
  }

  set status(v: PluginStatus) {
    this._status = v;

    const channel = genTouchChannel()!;
    channel &&
      channel.send(ChannelType.MAIN, "plugin-status-updated", {
        plugin: this.name,
        status: this._status,
      });
  }

  addFeature(feature: IPluginFeature): boolean {
    if (this.features.find((f) => f.name === feature.name)) return false;

    const { id, name, desc, commands } = feature;

    const regex = /^[a-zA-Z0-9_-]+$/;
    if (!regex.test(id)) return false;

    if (
      disallowedArrays.filter(
        (item: string) => name.indexOf(item) !== -1 || desc.indexOf(item) !== -1
      )
    ) {
      return false;
    }

    if (commands.length < 1) return false;

    return this.features.push(feature) >= 0;
  }

  delFeature(featureId: string): boolean {
    if (!this.features.find((f) => f.name === featureId)) return false;

    return (
      this.features.splice(
        this.features.findIndex((f) => f.name === featureId),
        1
      ) !== undefined
    );
  }

  getFeature(featureId: string): IPluginFeature | null {
    return this.features.find((f) => f.name === featureId) || null;
  }

  getFeatures(): IPluginFeature[] {
    return this.features;
  }

  constructor(
    name: string,
    icon: PluginIcon,
    version: string,
    desc: string,
    readme: string,
    dev: IPluginDev,
    pluginPath: string,
    platforms: IPlatform = {}
  ) {
    this.name = name;
    this.icon = icon;
    this.version = version;
    this.desc = desc;
    this.readme = readme;
    this.dev = dev;

    this.pluginPath = pluginPath;
    this.platforms = platforms;
    this.features = [];
  }

  async enable(): Promise<boolean> {
    if (
      this.status !== PluginStatus.DISABLED &&
      this.status !== PluginStatus.LOADED &&
      this.status !== PluginStatus.CRASHED &&
      this.status !== PluginStatus.LOADING
    )
      return Promise.resolve(false);

    this.status = PluginStatus.LOADING;

    this.webview = this.__getInjections__();

    const app = genTouchApp();

    await genTouchChannel(app).send(ChannelType.MAIN, "plugin-webview", {
      plugin: this.name,
      data: this.webview,
    });

    this.status = PluginStatus.ENABLED;

    await genTouchChannel().send(ChannelType.PLUGIN, "@lifecycle:en", {
      ...this.toJSONObject(),
      plugin: this.name,
    });

    return Promise.resolve(true);
  }

  __getInjections__() {
    const indexPath = this.__index__();
    const preload = this.__preload__();

    const app = genTouchApp();

    const _path = {
      relative: path.relative(app.rootPath, this.pluginPath),
      root: app.rootPath,
      plugin: this.pluginPath,
    };

    const mainWin = app.window.window;

    return {
      _: {
        indexPath,
        preload,
        isWebviewInit: this.webViewInit,
      },
      attrs: {
        enableRemoteModule: "false",
        nodeintegration: "true",
        webpreferences: "contextIsolation=false",
        // httpreferrer: `https://plugin.touch.talex.com/${this.name}`,
        websecurity: "false",
        useragent: `${mainWin.webContents.userAgent} TalexTouch/${pkg.version} (Plugins,like ${this.name})`,
        // partition: `persist:touch/${this.name}`,
      },
      styles: `${getStyles()}`,
      js: `${getJs([this.name, JSON.stringify(_path)])}`,
    };
  }

  async disable(): Promise<boolean> {
    if (this.status !== PluginStatus.ENABLED) return Promise.resolve(false);

    this.status = PluginStatus.DISABLING;
    console.log("[Plugin] Disabling plugin " + this.name);

    genTouchChannel().send(ChannelType.PLUGIN, "@lifecycle:di", {
      ...this.toJSONObject(),
      plugin: this.name,
    });

    this.webViewInit = false;

    this._windows.forEach((win, id) => {
      win.close();
      this._windows.delete(id);
    });

    this.status = PluginStatus.DISABLED;
    console.log("[Plugin] Plugin " + this.name + " is disabled.");

    return Promise.resolve(true);
  }

  __preload__() {
    const preload = path.join(this.pluginPath, "preload.js");

    return fse.existsSync(preload) ? preload : undefined;
  }

  __index__() {
    const dev = this.dev && this.dev.enable;

    if (dev) console.log("[Plugin] Plugin is now dev-mode: " + this.name);

    return dev
      ? this.dev && this.dev.address
      : path.resolve(this.pluginPath, "index.html");
  }
}

class PluginManager implements IPluginManager {
  plugins: Map<string, ITouchPlugin> = new Map();
  active: string = "";

  pluginPath: string;
  watcher: chokidar.FSWatcher | null;

  constructor(pluginPath: string) {
    this.pluginPath = pluginPath;
    this.watcher = null;

    this.__init__();
  }

  getPluginList(): Array<Object> {
    const list = [];

    for (const plugin of this.plugins.values())
      list.push((plugin as TouchPlugin).toJSONObject());

    return list;
  }

  setActivePlugin(pluginName: string): boolean {
    if (this.active) {
      const plugin = this.plugins.get(this.active);

      genTouchChannel().send(ChannelType.PLUGIN, "@lifecycle:in", {
        plugin: this.active,
      });

      if (plugin) plugin.status = PluginStatus.ENABLED;
    }

    if (pluginName) {
      const plugin = this.plugins.get(pluginName);
      if (!plugin || plugin.status !== PluginStatus.ENABLED) return false;

      plugin.status = PluginStatus.ACTIVE;
      this.active = pluginName;

      genTouchChannel().send(ChannelType.PLUGIN, "@lifecycle:ac", {
        plugin: pluginName,
      });
    }

    return true;
  }

  hasPlugin(name: string) {
    return this.plugins.has(name);
  }

  __init__() {
    if (!fse.existsSync(this.pluginPath)) return;

    // const plugins = fse.readdirSync(this.pluginPath);

    touchEventBus.on(TalexEvents.BEFORE_APP_QUIT, () => {
      this.watcher!.close();
      console.log("[PluginManager] Watcher closed.");
    });

    this.watcher = chokidar.watch(this.pluginPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 500,
      },
    });

    this.watcher.on("change", async (_path) => {
      const baseName = path.basename(_path);
      if (baseName.indexOf(".") === 0) return;

      const pluginName = path.basename(path.dirname(_path));

      if (!this.hasPlugin(pluginName)) {
        console.warn(
          "[PluginManager] IGNORE | The plugin " +
            pluginName +
            " isn't loaded despite changes made to its file."
        );

        this.loadPlugin(pluginName);
        return;
      }
      let plugin = this.plugins.get(pluginName) as TouchPlugin;

      console.log(
        `[Plugin] ${pluginName}'s ${baseName} has been changed, reload it.`
      );

      if (
        baseName === "manifest.json" ||
        baseName === "preload.js" ||
        baseName === "index.html"
      ) {
        let _enabled = plugin.status === PluginStatus.ENABLED;

        await plugin.disable();
        await this.unloadPlugin(pluginName);

        await this.loadPlugin(pluginName);

        plugin = this.plugins.get(pluginName) as TouchPlugin;

        genTouchChannel().send(ChannelType.MAIN, "plugin:reload", {
          source: "disk",
          plugin: (plugin as TouchPlugin).toJSONObject(),
        });

        console.log("plugin reload event sent");

        _enabled && (await plugin.enable());
      } else if (baseName === "README.md") {
        plugin.readme = fse.readFileSync(_path, "utf-8");

        genTouchChannel().send(ChannelType.MAIN, "plugin:reload-readme", {
          source: "disk",
          plugin: pluginName,
          readme: plugin.readme,
        });
      } else {
        console.warn(
          "[PluginManager] Plugin " +
            pluginName +
            "'s " +
            baseName +
            " has been changed, but it's not a valid file."
        );
      }
    });

    this.watcher.on("addDir", (_path) => {
      if (!fse.existsSync(_path + "/manifest.json")) return;
      const pluginName = path.basename(_path);

      if (
        pluginName.indexOf(".") !== -1 ||
        pluginName.indexOf("\\") !== -1 ||
        pluginName.indexOf("/") !== -1
      ) {
        console.log(
          `[PluginManager] IGNORE | Plugin ${pluginName} has been added, but it's not a valid name.`
        );
        return;
      }

      console.log(`[Plugin] Plugin ${pluginName} has been added`);

      if (this.hasPlugin(pluginName)) {
        console.log(`[PluginManager] Reload plugin ${pluginName}`);
        genTouchChannel().send(ChannelType.MAIN, "plugin:reload", {
          source: "disk",
          plugin: pluginName,
        });
        return;
      }

      this.loadPlugin(pluginName);
    });

    this.watcher.on("unlinkDir", (_path) => {
      const pluginName = path.basename(_path);
      console.log(`[Plugin] Plugin ${pluginName} has been removed`);

      if (!this.hasPlugin(pluginName)) return;

      this.unloadPlugin(pluginName);
    });

    this.watcher.on("ready", () => {
      console.log(
        "[PluginManager] Initial scan complete. Ready for changes. (" +
          this.pluginPath +
          ")"
      );
    });

    this.watcher.on("error", (error) => {
      console.error("[PluginManager] Error happened", error);
      console.log(`[PluginManager] ${error}`);
    });

    // plugins.forEach(this.loadPlugin);
  }

  async listPlugins(): Promise<Array<string>> {
    return fse.readdirSync(this.pluginPath);
  }

  loadPlugin(pluginName: string): Promise<boolean> {
    const pluginPath = path.resolve(this.pluginPath, pluginName);
    const manifestPath = path.resolve(pluginPath, "manifest.json");

    if (!fse.existsSync(pluginPath) || !fse.existsSync(manifestPath)) {
      console.warn(
        "[PluginManager] IGNORE | The plugin " +
          pluginName +
          " isn't loaded because it's not a valid plugin."
      );
      return Promise.resolve(false);
    }

    const pluginInfo = fse.readJSONSync(manifestPath);
    if (pluginInfo.name !== pluginName) {
      console.warn(
        "[PluginManager] IGNORE | The plugin " +
          pluginName +
          " isn't loaded because it's name not matched."
      );
      return Promise.resolve(false);
    }

    const readme = ((p) =>
      fse.existsSync(p)
        ? (this.watcher!.add(p), fse.readFileSync(p).toString())
        : "")(path.resolve(pluginPath, "README.md"));

    const icon = new PluginIcon(
      pluginPath,
      pluginInfo.icon.type,
      pluginInfo.icon.value
    );

    const touchPlugin = new TouchPlugin(
      pluginInfo.name,
      icon,
      pluginInfo.version,
      pluginInfo.description,
      readme,
      pluginInfo.dev,
      pluginPath,
      pluginInfo.platforms
    );

    this.plugins.set(pluginInfo.name, touchPlugin);

    genTouchChannel().send(ChannelType.MAIN, "plugin:add", {
      plugin: touchPlugin,
    });
    console.log("[PluginManager] Load plugin " + pluginName + " done!");

    return Promise.resolve(true);
  }

  unloadPlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);

    if (!plugin) return Promise.resolve(false);

    this.watcher!.unwatch(
      path.resolve(path.resolve(this.pluginPath, pluginName), "README.md")
    );

    plugin.disable();

    this.plugins.delete(pluginName);

    genTouchChannel().send(ChannelType.MAIN, "plugin:del", {
      plugin: pluginName,
    });
    console.log("[Plugin] Disabling plugin " + pluginName);

    return Promise.resolve(true);
  }
}

let pluginManager: IPluginManager | null = null;

export function genPluginManager(pluginPath?: string) {
  if (!pluginManager) pluginManager = new PluginManager(pluginPath!);

  return pluginManager!;
}

export default {
  name: Symbol("PluginManager"),
  filePath: "plugins",
  init(app) {
    genPluginManager(path.join(app.rootPath, "modules", "plugins"));

    const touchChannel = genTouchChannel();

    touchChannel.regChannel(ChannelType.MAIN, "plugin-list", () =>
      (pluginManager as PluginManager).getPluginList()
    );
    touchChannel.regChannel(ChannelType.MAIN, "change-active", ({ data }) =>
      pluginManager!.setActivePlugin(data!.name)
    );
    touchChannel.regChannel(ChannelType.MAIN, "enable-plugin", ({ data }) => {
      const plugin = pluginManager!.plugins.get(data!.name);
      if (!plugin) return false;

      return plugin.enable();
    });
    touchChannel.regChannel(ChannelType.MAIN, "disable-plugin", ({ data }) => {
      const plugin = pluginManager!.plugins.get(data!.name);
      if (!plugin) return false;

      plugin.disable();
    });
    touchChannel.regChannel(ChannelType.MAIN, "get-plugin", ({ data }) =>
      pluginManager!.plugins.get(data!.name)
    );
    touchChannel.regChannel(ChannelType.MAIN, "webview-init", ({ data }) => {
      const plugin = pluginManager!.plugins.get(data!.name);
      if (!plugin) return false;

      return (plugin.webViewInit = true);
    });
    // this.listeners.push(
    //   touchChannel.regChannel(ChannelType.MAIN, "pack-export", ({ data }) => {
    //     const plugin = pluginManager.plugins.get(data);
    //     if (!plugin) return false;

    //     console.log("[Plugin] Pack plugin " + data.plugin + " and export it.");

    //     new PluginPackager(plugin, data.manifest, data.files).pack();
    //   })
    // );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "crash",
      async ({ data, plugin }) => {
        touchChannel.send(ChannelType.MAIN, "plugin-crashed", {
          plugin,
          ...data,
        });

        touchChannel.send(ChannelType.PLUGIN, "@lifecycle:cr", {
          plugin,
          ...data,
        });
      }
    );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "feature:reg",
      ({ data, plugin }) => {
        const { feature } = data!;
        const pluginIns = pluginManager!.plugins.get(plugin!);

        return pluginIns?.addFeature(feature);
      }
    );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "feature:unreg",
      ({ data, plugin }) => {
        const { feature } = data!;
        const pluginIns = pluginManager!.plugins.get(plugin!);

        return pluginIns?.delFeature(feature);
      }
    );

    // touchChannel.regChannel(
    //   ChannelType.MAIN,
    //   "plugin:new",
    //   async ({ data }) => {
    //     if (Object.hasOwn(data, 'template') && data.template !== false) {
    //       return console.error('[Plugin] Plugin template is not supported yet.')
    //     }
    //     const { name, desc, version, dev, readme, openInVSC } = data;

    //     const manifest = {

    //     }
    //   }
    // )

    touchChannel.regChannel(
      ChannelType.MAIN,
      "plugin:explorer",
      async ({ data }) => {
        const plugin = pluginManager!.plugins.get(data) as TouchPlugin;
        if (!plugin)
          return console.error(
            "[PluginManager] Error open plugin in explorer",
            data
          );

        const pluginPath = plugin.pluginPath;

        const { exec } = require("child_process");
        exec(`explorer ${pluginPath}`, (err: any) => {
          if (err) {
            console.error(err);
            return;
          }
        });
      }
    );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "window:new",
      async ({ data, plugin, reply }) => {
        const touchPlugin = pluginManager!.plugins.get(plugin!) as TouchPlugin;
        if (!touchPlugin)
          return reply(DataCode.ERROR, { error: "Plugin not found!" });

        const win = new TouchWindow(data);

        let webContents: Electron.WebContents;

        if (data.file) {
          webContents = await win.loadFile(data.file);
        } else if (data.url) {
          webContents = await win.loadURL(data.url);
        } else {
          return reply(DataCode.ERROR, { error: "No file or url provided!" });
        }

        console.log("[Plugin] Window loaded for plugin " + plugin);

        const obj = touchPlugin.__getInjections__();

        await webContents.insertCSS(obj.styles);
        await webContents.executeJavaScript(obj.js);

        webContents.send("@loaded", {
          id: webContents.id,
          plugin,
          type: "intend",
        });

        touchPlugin._windows.set(webContents.id, win);

        win.window.on("closed", () =>
          touchPlugin._windows.delete(webContents.id)
        );

        console.log("[Plugin] Create new window for plugin " + plugin);

        return reply(DataCode.SUCCESS, { id: webContents.id });
      }
    );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "window:visible",
      ({ data, plugin }) => {
        const touchPlugin = pluginManager!.plugins.get(plugin!) as TouchPlugin;
        if (!touchPlugin) return { error: "Plugin not found!" };

        const win = touchPlugin._windows.get(data.id);
        if (!win) return { error: "Window not found!" };

        if (data.hasOwnProperty("visible")) {
          data.visible ? win.window.show() : win.window.hide();
        } else win.window.isVisible() ? win.window.hide() : win.window.show();

        return true;
      }
    );

    touchChannel.regChannel(
      ChannelType.PLUGIN,
      "window:property",
      ({ data, plugin }) => {
        const touchPlugin = pluginManager!.plugins.get(plugin!) as TouchPlugin;
        if (!touchPlugin) return { error: "Plugin not found!" };

        const { id, property }: { id: number; property: WindowProperties } =
          data;

        const win = touchPlugin._windows.get(id)!;
        if (!win) return { error: "Window not found!" };

        const window: BrowserWindow | MicaBrowserWindow = win.window;

        function bind2Objs<
          T extends Object,
          P extends WindowProperty | WebContentsProperty,
        >(obj: T, property: P) {
          Object.keys(property).forEach((k) => {
            const key = k as keyof P;
            const v = property[key];

            if (v instanceof Function) (v as Function).apply(obj, v);
            else Object.assign(obj, { [key]: v });
          });
        }

        property.window && bind2Objs(window, property.window);

        property.webContents &&
          bind2Objs(window.webContents, property.webContents);

        return true;
      }
    );
  },
  destroy() {
    const plugins = pluginManager!.plugins;

    plugins.forEach((plugin) => plugin.disable());
    console.log("All plugins were closed!");
  },
} as TalexTouch.IModule;
