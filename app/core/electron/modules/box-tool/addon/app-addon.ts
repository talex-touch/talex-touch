import WinApp from './apps/win'
import DarwinApp from './apps/darwin'
import LinuxApp from './apps/linux'

import PinyinMatch from 'pinyin-match'
import PinyinMatchTw from 'pinyin-match/es/traditional.js';

const env = process.platform

let appSearch: any;

if (env === 'darwin') {
  appSearch = DarwinApp
} else if (env === 'win32') {
  appSearch = WinApp
} else if (env === 'linux') {
  appSearch = LinuxApp
}

export function getApps() {
  return appSearch()
}

export let apps: any = appSearch()
let appNames: any = apps.map((app: any) => app.name)

function check(keyword: string, appName: string) {
  let res = PinyinMatch.match(appName, keyword)

  if (res !== false) return res

  return PinyinMatchTw.match(appName, keyword)
}

export default async (keyword: string) => {
  let res = []

  let index = 0;
  for (let appName of appNames) {
    const matched = check(keyword, appName)

    if (matched !== false) {
      const app = apps[index++]
      res.push({
        ...app,
        matched
      })
    }
  }

  return res
}