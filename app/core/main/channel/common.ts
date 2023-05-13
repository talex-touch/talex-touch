import packageJson from './../../package.json'
import { shell } from 'electron'
import os from 'os'
import { ChannelType } from '~/../../packages/utils/channel'
import { genTouchChannel } from '../core/channel-core'
import { TalexTouch } from '../types'

function closeApp(app: TalexTouch.TouchApp) {

    app.window.close()

    app.app.quit()

    process.exit(0)

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
        version: os.version()
    }
}

export default {
    name: Symbol("CommonChannel"),
    listeners: new Array<Function>,
    init(app) {

        const channel = genTouchChannel(app)

        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'close', closeApp.bind(app, this)))
        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'minimize', app.window.minimize))
        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'dev-tools', () => app.window.openDevTools({ mode: 'detach' })))
        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'get-package', () => packageJson))
        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'open-external', ({ data }) => shell.openExternal(data.url)))
        this.listeners.push(channel.regChannel(ChannelType.MAIN, 'get-os', getOSInformation))

    
        // regChannel('app-storage', ({ reply, data }) => {
        //     const action = data.action
        //     if (!action) return reply("No action")
    
        //     if (data.save) {
        //         reply(saveConfig(action, data.content, data.clear))
        //     } else if (data.reload) {
        //         reply(reloadConfig(action))
        //     } else reply(getConfig(action))
    
        // })

    },
    destroy() {
        this.listeners.forEach((f: () => void) => f());
    },
} as TalexTouch.IModule