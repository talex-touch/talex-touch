import path from "path";
import fse from "fs-extra";
import { APP_FOLDER_NAME, MainWindowOption } from "../config/default";
import {
  AfterAppStartEvent,
  AppReadyEvent,
  AppSecondaryLaunch,
  AppStartEvent,
  BeforeAppQuitEvent,
  BeforeAppStartEvent,
  TalexEvents,
  touchEventBus,
} from "./eventbus/touch-event";
import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  WebContents,
  app,
} from "electron";
import { release } from "os";
import { checkDirWithCreate } from "../utils/common-util";
import { genTouchChannel } from "./channel-core";
import { ITouchChannel } from "utils/channel";
import { TalexTouch } from "../types/touch-core";

// Disable GPU Acceleration for Windows 7
if (release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.addListener("ready", (event, launchInfo) =>
  touchEventBus.emit(
    TalexEvents.APP_READY,
    new AppReadyEvent(event, launchInfo)
  )
);

class TouchApp implements TalexTouch.TouchApp {
  readonly rootPath: string = path.join(process.cwd(), APP_FOLDER_NAME);

  app: Electron.App;

  /**
   * App main window
   */
  window: TouchWindow;

  config: TalexTouch.IConfiguration;

  version: TalexTouch.AppVersion = app.isPackaged
    ? TalexTouch.AppVersion.RELEASE
    : TalexTouch.AppVersion.DEV;

  moduleManager: TalexTouch.IModuleManager;

  channel: ITouchChannel;

  constructor(app: Electron.App) {
    this.app = app;
    this.window = new TouchWindow(MainWindowOption);
    this.channel = genTouchChannel(this);
    this.moduleManager = new ModuleManager(this, this.channel);
    this.config = new TouchConfig(this);

    this.__init__();
    console.log("[TouchApp] TouchApp initialized!")
  }

  async __init__() {
    touchEventBus.emit(TalexEvents.APP_START, new AppStartEvent());

    checkDirWithCreate(this.rootPath, true);

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("before-quit", (event) =>
      touchEventBus.emit(
        TalexEvents.BEFORE_APP_QUIT,
        new BeforeAppQuitEvent(event)
      )
    );

    this.app.addListener("ready", () =>
      touchEventBus.emit(TalexEvents.APP_READY, new BeforeAppStartEvent())
    );
    this.app.addListener(
      "second-instance",
      (event, argv, workingDirectory, additionalData) =>
        touchEventBus.emit(
          TalexEvents.APP_SECONDARY_LAUNCH,
          new AppSecondaryLaunch(event, argv, workingDirectory, additionalData)
        )
    );

    let webContents: Electron.WebContents;

    if (this.version === TalexTouch.AppVersion.RELEASE) {
      webContents = await this.window.loadFile(
        path.join(__dirname, "../renderer/index.html")
      );
    } else {
      webContents = await this.window.loadURL(
        process.env["ELECTRON_RENDERER_URL"] as string,
        { devtools: true }
      );
    }

    webContents.addListener("did-finish-load", () => {
      webContents.executeJavaScript(
        `window._firstInit = ${process.getCreationTime()}`
      );
    });
  }
}

export class TouchWindow implements TalexTouch.ITouchWindow {
  window: BrowserWindow;

  constructor(options?: BrowserWindowConstructorOptions) {
    this.window = new BrowserWindow(options);

    this.window.once("ready-to-show", () => this.window.show());
  }

  close(): void {
    this.window.close();
  }
  minimize(): void {
    this.window.minimize();
  }
  openDevTools(options?: Electron.OpenDevToolsOptions): void {
    this.window.webContents.openDevTools(options);
  }

  loadURL(
    url: string,
    options?: TalexTouch.LoadURLOptions | undefined
  ): Promise<WebContents> {
    return new Promise(async (resolve) => {
      await this.window.loadURL(url, options);

      if (options?.devtools)
        this.window.webContents.openDevTools({
          mode: options.devtools === true ? "detach" : options.devtools,
        });

        this.window.show()

      resolve(this.window.webContents);
    });
  }

  loadFile(
    filePath: string,
    options?: TalexTouch.LoadFileOptions | undefined
  ): Promise<WebContents> {
    return new Promise(async (resolve) => {
      await this.window.loadFile(filePath, options);

      if (options?.devtools)
        this.window.webContents.openDevTools({
          mode: options.devtools === true ? "detach" : options.devtools,
        });

      resolve(this.window.webContents);
    });
  }
}

class ModuleManager implements TalexTouch.IModuleManager {
  private modules: Map<Symbol, TalexTouch.IModule> = new Map();

  modulePath: string;

  touchChannel: ITouchChannel;

  constructor(touchApp: TouchApp, touchChannel: ITouchChannel) {
    this.modulePath = path.join(touchApp.rootPath, "modules");
    this.touchChannel = touchChannel;

    checkDirWithCreate(this.modulePath, true);
  }

  loadModule(module: TalexTouch.IModule): boolean {
    const _module = this.modules.get(module.name);
    if (_module) {
      return false;
    } else
      return (() => {
        checkDirWithCreate(
          path.join(this.modulePath, module.filePath || module.name.description),
          true
        );

        setTimeout(module.init.bind(module, touchApp, touchApp.moduleManager));
        return this.modules.set(module.name, _module).has(module.name);
      })();
  }

  unloadModule(moduleName: Symbol): boolean {
    return (() => {
      const _module = this.modules.get(moduleName);
      if (!_module) return false;
      _module.destroy(touchApp, this);
      return this.modules.delete(moduleName);
    })();
  }

  getModule(moduleName: Symbol): TalexTouch.IModule {
    return this.modules.get(moduleName)!;
  }
}

class TouchConfig implements TalexTouch.IConfiguration {
  configPath: string

  constructor(touchApp: TouchApp) {
    this.configPath = path.join(touchApp.rootPath, "config")
    checkDirWithCreate(this.configPath, true);

    if (fse.existsSync(path.resolve(this.configPath, "dev.talex"))) {
      process.env.TALEX_DEV = "true";
      touchApp.version = TalexTouch.AppVersion.DEV;

      console.log("[Config] Dev mode enabled");

      touchApp.window.window.webContents.openDevTools({
        mode: "undocked",
        activate: true,
      });
    }
  }
}

let touchApp: TouchApp | null = null;

export function genTouchApp() {
  if (!touchApp) {
    touchEventBus.emit(TalexEvents.BEFORE_APP_START, new BeforeAppStartEvent());
    touchApp = new TouchApp(app);
    touchEventBus.emit(TalexEvents.AFTER_APP_START, new AfterAppStartEvent());
  }
  return touchApp!;
}