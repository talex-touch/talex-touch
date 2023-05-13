export enum PluginStatus {
  DISABLED,
  DISABLING,
  
  CRASHED,

  ENABLED,
  ACTIVE,
  
  LOADING,
  LOADED
}

export interface IPluginIcon {
  type: string | 'remixicon'
  value: any
}

export interface IPluginBaseInfo {
  name: string
  readme: string
  version: string
  desc: string
  icon: IPluginIcon
}

export interface IPluginDev {
  enable: boolean
  address: string
}

export interface IPluginWebview {
}

export interface ITouchPlugin extends IPluginBaseInfo {
  dev: IPluginDev
  webViewInit: boolean
  webview: IPluginWebview

  get status(): PluginStatus
  set status(v: PluginStatus)

  enable(): Promise<boolean>
  disable(): Promise<boolean>
}

export interface IPluginManager {
  plugins: Map<string, ITouchPlugin>
  active: string | null

  setActivePlugin(pluginName: string): boolean
  
  loadPlugin(pluginName: string): Promise<boolean>
  unloadPlugin(pluginName: string): Promise<boolean>
}