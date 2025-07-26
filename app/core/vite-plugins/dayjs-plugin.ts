import { Plugin } from 'vite'

export function dayjsPlugin(): Plugin {
  return {
    name: 'dayjs-plugin',
    resolveId(id) {
      // 处理 dayjs 插件的导入
      if (id.startsWith('dayjs/plugin/')) {
        return id
      }
      return null
    },
    load(id) {
      // 为 dayjs 插件提供默认导出
      if (id.startsWith('dayjs/plugin/')) {
        const pluginName = id.replace('dayjs/plugin/', '').replace('.js', '')
        return `
          const plugin = require('dayjs/plugin/${pluginName}');
          export default plugin;
        `
      }
      return null
    }
  }
}
