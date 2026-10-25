# 歌单解析器

一个 Windows 便携小工具：粘贴音乐平台的歌单分享链接，把歌单整理成文字歌单，并可以备份到你自己的 GitHub 仓库。

## 功能

-  支持酷狗、网易云、QQ 音乐、咪咕、酷我五个平台的歌单，无需登录
-  导出文字歌单（「歌名 - 歌手」列表，Markdown 格式）或原始数据（JSON）
-  导入 LX Music 导出的歌单文件（`.lxmc` / `.json`），单个列表或完整备份都可以
-  备份到自己的 GitHub 仓库：装了 git 直接用 git，没有 git 用令牌
-  便携版：一个 exe 文件，不用安装，双击即用

## 本项目的定位

这是一个**独立的小工具**

- **只做歌单这一件事**：把歌单变成可阅读、可保存的文字歌单和 JSON
- **不需要服务器**：歌单备份到你自己的 Git 仓库，借助 Git 的提交历史，每次变化都有记录、可以回看
- **在网页上直接看**：备份里的 `.md` 文字歌单在 GitHub 网页上就能浏览，手机上也能看
- **单向备份**：只把歌单写进仓库，不会改动 LX Music 里的任何数据。要恢复时，在 LX Music 里手动「导入」备份的 `.json`

如果你需要的是多台设备之间实时同步 LX Music 的列表，请使用 LX Music 自带的同步功能，本项目不提供这类能力。

## 使用方法
### **您需要自己构建此应用，如果您需要帮助请参见后文或者直接使用AI-agent部署**
1. 双击 `歌单解析器-x.x.x-portable.exe`（首次启动需要几秒）
2. 选择平台，粘贴歌单的分享链接，点「解析」。歌单较长时勾选「拉取全部歌曲」
3. 点「导出文字歌单」或「导出 JSON」保存到本地

也可以点「导入 LX 歌单文件」，打开从 LX Music 导出的文件。在 LX Music 里导出的位置：

- 单个列表：「我的列表」里右键某个列表 →「导出」
- 全部列表：「设置 → 备份与恢复 → 导出列表 / 导出所有数据」（设置部分不会上传）

## 备份歌单到 GitHub

每个歌单写两份文件，默认放在仓库的 `playlists/` 目录下：

- `歌单名.json`：原始数据。来自 LX Music 导出文件的，可以在 LX Music 里「导入」还原
- `歌单名.md`：文字歌单（歌名 - 歌手）

第一次备份时，如果仓库里没有 README，会自动生成一份说明来源的 README，已有的不会被覆盖。
每次备份只产生一个 commit；内容没变时不提交；备份**从不删除**仓库里的文件。

### 第 1 步：建一个仓库

在 GitHub 上新建一个仓库（例如 `my-playlists`），**建议选 Private（私有）**，否则所有人都能看到你的歌单。
空仓库也可以，不用勾选初始化 README。

### 第 2 步：选备份方式

| 方式 | 适合谁 | 需要什么 |
|---|---|---|
| **git 模式** | 电脑上装了 git，平时用 git / VS Code 推过代码 | 什么都不用填，沿用电脑上已有的 git 登录 |
| **令牌模式** | 电脑上没有 git | 一个 GitHub 令牌（教程见下） |

默认是「自动」：检测到本机有 git 就用 git 模式，没有就用令牌模式。也可以手动指定。

#### git 模式

前提：

1. 已安装 git。没有的话去 <https://git-scm.com> 下载。
2. 这台电脑已经登录过 GitHub：在终端或 VS Code 里对任意 GitHub 仓库 push 成功过一次就行。
   用 SSH 的，仓库地址填 `git@github.com:用户名/仓库.git` 即可。
3. 配置过 git 用户名和邮箱：
   ```bash
   git config --global user.name "你的名字"
   git config --global user.email "你的邮箱"
   ```

本工具不会弹出登录窗口，也不读取或保存你的 git 密码；如果提示「git 登录失败」，先在终端里对这个仓库 push 一次完成登录。
git 模式下仓库地址可以填任意 git 地址（例如 Gitee），不限于 GitHub。

#### 令牌模式

推荐用 **Fine-grained token**，只给这一个仓库的权限：

1. 打开 <https://github.com/settings/personal-access-tokens/new>
   （或：头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token）
2. **Token name** 随便填；**Expiration** 选一个有效期（到期后重新生成即可）
3. **Repository access** 选 **Only select repositories**，然后只勾选第 1 步建的仓库
4. **Permissions → Repository permissions** 里找到 **Contents**，改成 **Read and write**（其他都不用动）
5. 点 **Generate token**，复制以 `github_pat_` 开头的令牌。**它只显示这一次**，丢了只能重新生成

令牌经 Windows 加密后保存在 exe 旁边的 `sync-config.json`，不会明文写入磁盘；加密绑定当前 Windows 账号，
换电脑或换账号后需要重新填写。令牌泄露时，到上面的令牌页面点 **Revoke** 作废，再生成一个新的。

### 第 3 步：备份

展开「GitHub 备份设置」→ 选备份方式、填仓库（`用户名/仓库名` 或完整地址）→ 令牌模式再填令牌 →
「测试连接」→「保存」。之后解析或导入歌单后点「备份到 GitHub」；勾选「解析/导入后自动备份」就不用每次手动点了。

## 构建 exe

### 需要什么

- Windows 10 / 11（x64）
- [Node.js](https://nodejs.org) ≥ 18（推荐 20 / 22 LTS）
- 联网：第一次构建会自动下载 Electron 和打包组件（winCodeSign、nsis），之后会复用缓存
- 约 1 GB 可用磁盘空间

不需要 Visual Studio、Python 或 C++ 编译工具。

### 步骤

```bash
git clone https://github.com/chatseeon/playlist-parser.git
cd playlist-parser
npm install
npm run dist:win
```

国内网络下载慢或超时，先在 PowerShell 里设置镜像再执行上面的命令：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

产物在 `release/歌单解析器-x.x.x-portable.exe`，就是这一个文件。`release/win-unpacked/` 是中间产物，可以删掉。

## 已知问题

- **提示「Windows 已保护你的电脑」**：exe 没有数字签名。点「更多信息 → 仍要运行」即可。
- **设置无法保存**：设置写在 exe 所在文件夹，请不要把 exe 放在 `C:\Program Files` 等没有写入权限的位置。
- **构建时报错 `Cannot create symbolic link` / `客户端没有所需的特权`**：Windows 默认不允许普通用户创建符号链接。
  在「设置 → 系统 → 高级 →开发者选项」开启**开发人员模式**或用管理员身份打开终端，
  删除 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` 后重新构建。
- **构建时下载超时 / `ECONNRESET`**：按上面设置镜像后重试。
- **卸载**：删掉 exe 和同目录的 `sync-config.json`；`%APPDATA%\playlist-parser` 下的运行缓存也可以一并删除。

## 许可证与来源

本项目以 [Apache License 2.0](LICENSE) 发布。

歌单解析部分改编自 [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)（LX Music 桌面版，Apache-2.0）。
具体改动见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。

本项目是独立的衍生作品，**非 LX Music 官方项目，与 LX Music 及其作者无关**，
LX Music 作者不对本项目负责；「LX Music」「洛雪音乐」名称仅用于说明代码来源和文件格式兼容性。

## 免责声明

1. 本项目完全免费、不以营利为目的，仅用于技术研究与个人学习，**禁止用于任何商业用途**。
2. 本项目只读取各音乐平台**公开的歌单信息**（歌名、歌手、专辑等元数据，与未登录状态下在官方 App 看到的一致），
   不提供、不获取、不存储、不分发任何音频文件，也不具备播放或下载音乐的功能。
3. 歌曲、歌单等数据的版权归各音乐平台及相应权利人所有，本项目不对数据的准确性、合法性负责。
4. 请勿使用本项目进行大规模抓取、高频请求或任何可能影响平台正常运行的行为。
   使用者应遵守所在地法律法规及各平台的用户协议，因使用本项目产生的一切后果由使用者自行承担。
5. 本项目按「原样」提供，不提供任何明示或暗示的担保，作者不对使用本项目造成的任何直接或间接损失负责
   （详见 Apache License 2.0 第 7、8 条）。
6. 如权利人认为本项目侵犯了其合法权益，请通过本仓库的 Issues 联系，核实后将第一时间删除相关内容或下架本项目。
7. 使用本项目即表示你已阅读并同意以上声明。
