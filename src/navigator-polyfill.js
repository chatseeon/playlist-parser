// Node 20（Electron 主进程用的就是 Node 20）没有全局 navigator，
// 而酷狗的 vendor 脚本 infSign 在「模块加载时」就会读 navigator.userAgent
// 判断运行环境，缺了会直接抛错、连带整个解析器起不来。
// 这里补一个最小实现；Node 21+ / 浏览器环境本来就有，不要覆盖。
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  }
}
