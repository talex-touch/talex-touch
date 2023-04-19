import { reactive } from "vue";
import {pluginManager, registerTypeProcess} from "@modules/samples/node-api";

export interface Plugin {
    pluginInfo:   PluginInfo;
    sourceConfig: string;
    process:      any[];
    _status:      number;
    webview: any;
}

export interface PluginInfo {
    name:          string;
    icon:          Icon;
    version:       string;
    description:   string;
    pluginSubInfo: PluginSubInfo;
    authors:       Author[];
}

export interface Author {
    name:         string;
    email:        string;
    website:      string;
    introduction: string;
    local:        string;
    position:     string;
}

export interface Icon {
    type:   string;
    value:  string;
    _value: string;
}

export interface PluginSubInfo {
    dev:       Dev;
    signature: string;
}

export interface Dev {
    enable:  boolean;
    address: string;
    source:  boolean;
}

class PluginAdpoter {

    readonly plugins: Map<string, typeof reactive<Plugin>> = new Map()

    _logouts = []

    constructor() {

        const plugins: object = pluginManager.getPluginList();

        // plugins 将 key: value 形式存储在map中
        Object.values(plugins).forEach(value => this.plugins.set(value.pluginInfo.name, reactive(value)))

        this._logouts.push(registerTypeProcess('plugin-status-updated', ({ data, reply }) =>  {
            const p = this.plugins.get(data.plugin)
            if ( p ) Object.assign(p, { _status: data.status })

            reply(1)
        }))
        this._logouts.push(registerTypeProcess('plugin-webview', ({ data }) =>  {
            console.log( 'plugin-webview', data )

            const p = this.plugins.get(data.plugin)
            if (!p) return

            const webview = {
                el: null,
                data: data.data
            }

            Object.assign(p, { webview })
        }))

    }

    _unmount() {

        this._logouts.forEach(v => v())

    }

    //     injectionObj.preload && webview.setAttribute('preload', "file://" + injectionObj.preload)
    //
    //     webview.addEventListener('did-finish-load', () => {
    //         console.log("Webview dom-ready")
    //         webview.openDevTools()
    //
    //         webview.insertCSS(\`${getStyles()}\`)
    //
    //         webview.executeJavaScript(String.raw \`${String.raw `${getJs([name, pluginInfo, sourceConfig, JSON.stringify(_path)])}`}\`)
    //
    //         webview.send('@talex-plugin:preload', "${name}")
    //     })
    //
    //     wrapper.appendChild(webview)

}

export const pluginAdopter = new PluginAdpoter()