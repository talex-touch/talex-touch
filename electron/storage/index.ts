import fse from 'fs-extra'
import path from 'path'
import { touchPath } from '../main/processor'
import { win } from '../main/index'

const basePath = path.resolve(touchPath, 'config')

if( !fse.existsSync(basePath) ) fse.mkdirSync(basePath)

if( fse.existsSync(path.resolve(basePath, 'dev.talex')) ) {
    console.log("[Config] Dev mode enabled")
    process.env.TALEX_DEV = "true"
}

const configs = {}

export function getConfig(name: string) {
    return configs[name] || (() => {
        const p = path.resolve(basePath, name)

        const file = fse.existsSync(p) ? JSON.parse(
            fse.readFileSync(p).toString()
        ) : {}

        configs[name] = file

        return file
    })()
}

export function reloadConfig(name: string) {
    const file = JSON.parse(
        fse.readFileSync(path.resolve(basePath, name)).toString()
    )

    configs[name] = file

    return file
}

export function saveConfig(name: string, content?: string, clear?: boolean): boolean {
    if( content && configs[name] ) {
        console.log("[Config] Save config", name, content, clear)
        const p = path.resolve(basePath, name)

        fse.createFileSync(p)
        fse.writeFileSync(p, content ? content : JSON.stringify(configs[name]))

        if ( clear ) {

            delete configs[name]

        } else {

            configs[name] = JSON.parse(content)

        }

        return true
    }
    return false
}

export function saveAllConfig() {
    Object.keys(configs).forEach(key => saveConfig(key))
}
