'use strict'

const api = window.screenshotAcceptance
const startButton = document.querySelector('#start-button')
const status = document.querySelector('#status')
const error = document.querySelector('#error')

startButton.addEventListener('click', async () => {
  startButton.disabled = true
  status.textContent = '正在启动隔离 CoreApp 完整截图工具链…'
  error.textContent = ''
  try {
    const result = await api.start()
    status.textContent = result.alreadyRunning
      ? '完整截图工具链已经在运行，请直接在屏幕覆盖层中框选。'
      : '已启动隔离 CoreApp。请在屏幕覆盖层中框选，随后使用截图编辑器完成复制或保存。'
  }
  catch (cause) {
    status.textContent = '截图工具未调起。'
    error.textContent = cause?.message || String(cause)
  }
  finally {
    startButton.disabled = false
  }
})
