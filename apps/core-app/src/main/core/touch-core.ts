import { TalexTouch } from "../types";
import { ChannelType, ITouchChannel } from "@talex-touch/utils/channel";
import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  OpenDevToolsOptions,
  WebContents,
  app,
  crashReporter,
} from "electron";
import fse from "fs-extra";
import { platform, release } from "os";
import path from "path";
import { APP_FOLDER_NAME, MainWindowOption } from "../config/default";
// import { genPluginManager } from "../plugins/plugin-core";
import { checkDirWithCreate } from "../utils/common-util";
import { genTouchChannel } from "./channel-core";
import {
  AfterAppStartEvent,
  AppReadyEvent,
  AppSecondaryLaunch,
  AppStartEvent,
  BeforeAppQuitEvent,
  BeforeAppStartEvent,
  OpenExternalUrlEvent,
  TalexEvents,
  WindowAllClosedEvent,
  touchEventBus,
} from "./eventbus/touch-event";
import * as log4js from "log4js";
import { devProcessManager } from "../utils/dev-process-manager";

const rootPath = getRootPath(process.cwd());

const logs = path.join(rootPath, "logs");
checkDirWithCreate(logs);

app.setPath("crashDumps", path.join(logs, "crashes"));

crashReporter.start({
  companyName: "TalexTouch",
  productName: "TalexTouch",
  submitURL: "",
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
  extra: {
    version: app.getVersion(),
  },
});

log4js.configure({
  appenders: {
    all: {
      type: "dateFile",
      keepFileExt: true,
      filename: path.join(logs, "D"),
      maxLogSize: 10485760,
      backups: 3,
      compress: true,
      alwaysIncludePattern: true,
      pattern: "yyyy-MM-dd.log",
    },
    out: {
      type: "stdout",
    },
    err: {
      type: "stderr",
    },
    error: {
      type: "dateFile",
      keepFileExt: true,
      filename: path.join(logs, "E"),
      maxLogSize: 10485760,
      backups: 3,
      compress: true,
      alwaysIncludePattern: true,
      pattern: "yyyy-MM-dd.err",
    },
  },
  categories: {
    default: {
      appenders: ["all", "out"],
      level: "INFO",
    },
    error: {
      appenders: ["all", "err", "error"],
      level: "ERROR",
    },
  },
});

console.log("TALEX TOUCH STARTED");

// Disable GPU Acceleration for Windows 7
if (release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  console.log("Secondary launch, app will quit.");

  app.on("second-instance", (event, argv, workingDirectory, additionalData) => {
    touchEventBus.emit(
      TalexEvents.APP_SECONDARY_LAUNCH,
      new AppSecondaryLaunch(event, argv, workingDirectory, additionalData)
    );
  });

  app.quit();
  process.exit(0);
}

app.on("window-all-closed", () => {
  console.log("[TouchApp] All windows closed! App starts to exit ...");
  touchEventBus.emit(TalexEvents.WINDOW_ALL_CLOSED, new WindowAllClosedEvent());

  if (process.platform !== "darwin") {
    if (!app.isPackaged) {
      console.log("[TouchApp] Development mode: Graceful shutdown initiated...");
      setTimeout(() => {
        app.quit();
        process.exit(0);
      }, 200);
    } else {
      app.quit();
      process.exit(0);
    }
  }
});

app.addListener("ready", (event, launchInfo) =>
  touchEventBus.emit(
    TalexEvents.APP_READY,
    new AppReadyEvent(event, launchInfo)
  )
);

app.on("before-quit", (event) => {
  touchEventBus.emit(
    TalexEvents.BEFORE_APP_QUIT,
    new BeforeAppQuitEvent(event)
  );
  console.log("[TouchApp] App will quit!");

  if (!app.isPackaged) {
    console.log("[TouchApp] Development mode: Using DevProcessManager for cleanup...");

    // Forbidden default quit behavior, let DevProcessManager handle it
    if (!devProcessManager.isShuttingDownProcess()) {
      event.preventDefault();
      devProcessManager.triggerGracefulShutdown();
      return;
    }
  }

  touchEventBus.emit(TalexEvents.WILL_QUIT, new BeforeAppQuitEvent(event));
});

function getRootPath(root: string) {
  return app.isPackaged
    ? path.join(root, APP_FOLDER_NAME)
    : path.join(root, "..", "..", APP_FOLDER_NAME);
}

export class TouchApp implements TalexTouch.TouchApp {
  readonly rootPath: string = rootPath;

  app: Electron.App;

  /**
   * App main window
   */
  window: TouchWindow;

  config: TalexTouch.IConfiguration;

  version: TalexTouch.AppVersion;

  moduleManager: TalexTouch.IModuleManager;

  channel: ITouchChannel;

  constructor(app: Electron.App) {
    console.log("[TouchApp] App running under: " + this.rootPath);
    checkDirWithCreate(this.rootPath, true);

    const _windowOptions = { ...MainWindowOption };

    this.app = app;
    this.version = app.isPackaged
      ? TalexTouch.AppVersion.RELEASE
      : TalexTouch.AppVersion.DEV;

    if (!app.isPackaged) {
      devProcessManager.init();
      console.log("[TouchApp] Development process manager initialized");
    }

    this.window = new TouchWindow(_windowOptions);
    this.channel = genTouchChannel(this);
    this.moduleManager = new ModuleManager(this, this.channel);
    this.config = new TouchConfig(this);

    this.__init__().then(() => {
      console.log("[TouchApp] TouchApp initialized!");
    });
  }

  async __init__() {
    const startTime = new Date().getTime();

    touchEventBus.emit(TalexEvents.APP_START, new AppStartEvent());

    checkDirWithCreate(this.rootPath, true);

    if (app.isPackaged || this.version === TalexTouch.AppVersion.RELEASE) {
      const url = path.join(process.env.DIST!, "index.html");

      this.window.window.show();
      console.log("[TouchApp] Loading (mainWindow) webContents from: " + url);

      await this.window.loadFile(`${url}`, {
        devtools: this.version === TalexTouch.AppVersion.DEV,
      });
    } else {
      const url = process.env["ELECTRON_RENDERER_URL"] as string;

      this.window.window.show();
      console.log("[TouchApp] Loading (mainWindow) webContents from: " + url);

      await this.window.loadURL(url, { devtools: true });
    }

    console.log("[TouchApp] WebContents loaded!");

    this.channel.regChannel(ChannelType.MAIN, "app-ready", ({ header }) => {
      const { event } = header
      // if () {
      //   genPluginManager().plugins.forEach((plugin) => {
      //       plugin.webViewInit = false;
      //     });
      // }

      return {
        id: (event.sender as Electron.WebContents).id,
        version: this.version,
        path: {
          rootPath: this.rootPath,
          appPath: app.getAppPath(),
          appDataPath: app.getPath("appData"),
          userDataPath: app.getPath("userData"),
          tempPath: app.getPath("temp"),
          homePath: app.getPath("home"),
          exePath: app.getPath("exe"),
          modulePath: path.join(this.rootPath, "modules"),
          configPath: path.join(this.rootPath, "config"),
          pluginPath: path.join(this.rootPath, "plugins"),
        },
        isPackaged: app.isPackaged,
        isDev: this.version === TalexTouch.AppVersion.DEV,
        isRelease: this.version === TalexTouch.AppVersion.RELEASE,
        platform: process.platform,
        arch: process.arch,
        t: {
          _s: process.getCreationTime(),
          s: startTime,
          e: new Date().getTime(),
          p: process.uptime(),
          h: process.hrtime(),
        },
      };
    });
  }
}

export class TouchWindow implements TalexTouch.ITouchWindow {
  window: BrowserWindow;

  constructor(options?: BrowserWindowConstructorOptions) {
    this.window = new BrowserWindow(options)

    /**
     * Auto apply Vibrancy(darwin) or MicaMaterial(windows) on window
     */
    if (process.platform === "darwin") {
      this.window.setVibrancy("fullscreen-ui");

      console.log("[TouchWindow] Apply Vibrancy on window");
    } else {
      this.window.setBackgroundMaterial('mica')

      console.log("[TouchWindow] Apply MicaMaterial on window");
    }

    this.window.once("ready-to-show", () => {
      this.window.webContents.addListener(
        "will-navigate",
        (event: any, url: string) => {
          touchEventBus.emit(
            TalexEvents.OPEN_EXTERNAL_URL,
            new OpenExternalUrlEvent(url)
          );

          event.preventDefault();
        }
      );
      this.window.show();
    });
  }

  close(): void {
    this.window.close();
  }
  minimize(): void {
    this.window.minimize();
  }
  openDevTools(options?: OpenDevToolsOptions): void {
    console.log("[TouchWindow] Open DevTools", options);
    this.window.webContents.openDevTools(options);
  }

  loadURL(
    url: string,
    options?: TalexTouch.LoadURLOptions | undefined
  ): Promise<WebContents> {
    return new Promise(async (resolve) => {
      await this.window.loadURL(url, options);

      if (options && options.devtools)
        this.window.webContents.openDevTools({
          mode: options.devtools === true ? "detach" : options.devtools,
        });

      this.window.webContents.addListener("render-process-gone", (event: any, details: any) => {
        console.error("[TouchWindow] Render process gone:", event, details);
        console.log("[TouchWindow] WebContents crashed!", this);

        // In development mode, if the process is killed, it's likely due to a hot reload
        if (!app.isPackaged && details.reason === 'killed') {
          console.log("[TouchWindow] Development mode: Process killed during hot reload, this is expected.");
          return;
        }

        // Other cases of crashes
        if (details.reason === 'crashed') {
          console.error("[TouchWindow] Renderer process crashed unexpectedly!");
        }
      });

      resolve(this.window.webContents);
    });
  }

  loadFile(
    filePath: string,
    options?: TalexTouch.LoadFileOptions | undefined
  ): Promise<WebContents> {
    return new Promise(async (resolve) => {
      await this.window.loadFile(filePath, options);

      if (options && options.devtools)
        this.window.webContents.openDevTools({
          mode: options.devtools === true ? "detach" : options.devtools,
        });

      this.window.webContents.addListener("render-process-gone", (event: any, details: any) => {
        console.error("[TouchWindow] Render process gone:", event, details);
        console.log("[TouchWindow] WebContents crashed!", this);

        // In development mode, if the process is killed, it's likely due to a hot reload
        if (!app.isPackaged && details.reason === 'killed') {
          console.log("[TouchWindow] Development mode: Process killed during hot reload, this is expected.");
          return;
        }

        // Other cases of crashes
        if (details.reason === 'crashed') {
          console.error("[TouchWindow] Renderer process crashed unexpectedly!");
        }
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

    touchEventBus.on(TalexEvents.BEFORE_APP_QUIT, () => {
      console.log("[ModuleManager] Starting graceful shutdown...");

      // In development mode, try to gracefully close all modules first
      if (!app.isPackaged) {
        console.log("[ModuleManager] Development mode: Gracefully shutting down modules...");

        // Give modules some time to clean up
        const modules = [...this.getAllModules()];
        modules.forEach((module: Symbol) => {
          try {
            console.log(`[ModuleManager] Unloading module: ${module.description}`);
            this.unloadModule(module);
          } catch (error) {
            console.warn(`[ModuleManager] Error unloading module ${module.description}:`, error);
          }
        });
      } else {
        [...this.getAllModules()].forEach((module: Symbol) => {
          this.unloadModule(module);
        });
      }

      console.log("[ModuleManager] All modules unloaded.");
    });
  }

  loadModule(module: TalexTouch.IModule): boolean | Promise<boolean> {
    const _module = this.modules.get(module.name);
    if (_module) {
      return false;
    } else
      return (async () => {
        const modulePath = path.join(
          this.modulePath,
          (module.filePath as string) || module.name.description!
        );

        if (!module.hasOwnProperty("filePath") || module.filePath)
          await checkDirWithCreate(modulePath, true);

        console.log(
          `[ModuleManager] Loading module ${module.name.description}`
        );

        setTimeout(
          module.init.bind(
            {
              ...module,
              touchChannel: this.touchChannel,
              modulePath,
              modules: [],
              getModule(name: Symbol) {
                return touchApp!.moduleManager.getModule(name);
              },
              getModules() {
                return this.modules.values();
              },
            },
            touchApp!,
            touchApp!.moduleManager
          )
        );
        return this.modules.set(module.name, _module!).has(module.name);
      })();
  }

  unloadModule(moduleName: Symbol): boolean {
    return (() => {
      const _module = this.modules.get(moduleName);
      if (!_module) return false;
      console.log("[ModuleManager] Unloading module " + moduleName.description);
      _module.destroy(touchApp!, this);
      return this.modules.delete(moduleName);
    })();
  }

  getModule(moduleName: Symbol): TalexTouch.IModule {
    return this.modules.get(moduleName)!;
  }

  getAllModules(): IterableIterator<Symbol> {
    return this.modules.keys();
  }
}

class TouchConfig implements TalexTouch.IConfiguration {
  configPath: string;
  data: TalexTouch.TouchAppConfig;

  constructor(touchApp: TouchApp) {
    this.configPath = path.join(touchApp.rootPath, "config");
    // const configFilePath = path.resolve(this.configPath, "config.ini");
    checkDirWithCreate(this.configPath, true);

    this.data = {
      frame: {
        height: 1280,
        width: 780,
      },
    };
  }

  triggerSave() {
    const configFilePath = path.resolve(this.configPath, "config.ini");
    fse.writeFileSync(configFilePath, JSON.stringify(this.data));

    console.log("[TouchConfig] Default config updated!");
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
