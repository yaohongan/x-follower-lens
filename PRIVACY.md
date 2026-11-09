# 隐私政策 / Privacy Policy

**粉丝透镜 Follower Lens** · 最后更新:2026-11-10

## 中文

**一句话:这个扩展不收集、不上传、不出售你的任何数据。**

### 它会读取什么
扩展只在 `x.com` 和 `twitter.com` 运行。它读取的是 **X 网页自己已经收到的数据**(用户名、粉丝数、关注数、注册时间、推文互动数、你与对方的关注关系,以及页面里自带的账号状态标记,如是否受保护、是否认证、X 加的风险提示),用来在页面上显示徽标和悬停卡片。

### 它会保存什么
以下内容保存在你浏览器的本地存储(`chrome.storage.local`)里,不会离开你的设备:
- **你的设置**(各开关、徽标位置等)。
- **粉丝数历史记录**:你浏览过的账号的用户名与粉丝数、记录时间,用于显示"近 7 天变化"。最多保存 3000 个账号、每个账号 40 个数据点。你可以随时在扩展的设置面板里点"清除记录"删除,或关闭"本地记录粉丝数变化"。
- **粉丝构成统计**:你打开某个账号的"关注者"列表时,扩展会把你**已经滚动加载出来**的那些粉丝的 **用户名、粉丝数、关注数、注册时间**记下来(不记简介、头像和推文),用来统计"粉丝里有多少人超过 3000 / 1 万粉丝"。最多保留 3 个账号、每个账号 2 万条。你可以在统计面板里"清除这个账号的统计"或"导出 CSV"(导出的文件只保存在你自己的电脑上)。
- **关注列表分析**:你打开某个账号的"正在关注"列表时,同样会把**已经滚动加载出来**的那些账号的 **用户名、粉丝数、关注数、注册时间、对方是否关注你**记在本地,用于"没关注你""疑似互粉号"等筛选和排序。最多保留 3 个账号、每个账号 1 万条,可在面板里清除或导出 CSV。
- **推文复盘**只用你浏览时已经在页面里的推文数据(浏览量、发布时间、互动数、开头几十个字),**只保存在当前页面的内存里**,关闭或刷新页面就没有了,不写入存储。

### 它不会做什么
- 不向任何服务器发送数据,不含任何统计、广告或跟踪代码。
- 不主动向 X 或其它网站发起数据请求,只读取页面本来就在收发的数据。**唯一的例外**:你点击个人主页上的「生成账号名片」时,会读取该账号的头像图片(来自 X 自己的图片服务器,和页面上显示的是同一张),只用于在你的浏览器里画这张图,不上传任何东西。名片的下载和复制都在本地完成。
- 不读取你的密码、私信、Cookie 或登录凭据。
- 不使用远程托管的代码,所有代码都在安装包里。

### 权限说明
- `storage`:保存上述设置和历史记录。
- 在 `x.com` / `twitter.com` 运行的内容脚本:读取页面数据并显示徽标。

### 联系方式
问题或建议请到 GitHub 提 issue:https://github.com/yaohongan/x-follower-lens/issues

---

## English

**In short: this extension does not collect, upload, or sell any of your data.**

**What it reads.** It runs only on `x.com` and `twitter.com`. It reads data that the X web page has *already received* (usernames, follower/following counts, account creation date, tweet engagement counts, and your follow relationship with each account) to render badges and hover cards on the page.

**What it stores.** The following is saved in your browser's local storage (`chrome.storage.local`) and never leaves your device: (1) your settings; (2) a follower-count history for accounts you have browsed (username, follower count, timestamp; capped at 3,000 accounts and 40 data points each) used to show 7-day changes; (3) when you open an account's "Followers" list, a compact record of the followers you have scrolled into view (username, follower count, following count, join date; no bio, avatar or posts; capped at 3 accounts and 20,000 rows each) used for the follower-composition panel; (4) likewise for a "Following" list (username, follower/following counts, join date, whether that account follows you; capped at 3 accounts and 10,000 rows each) used for filtering and sorting. You can clear these or export them as CSV from the panels; exports stay on your computer. The "post review" panel uses only tweet data already on the page and keeps it in page memory only (nothing is written to storage). You can delete it anytime with "Clear history" in the extension popup, or turn history tracking off.

**What it does not do.** It sends no data to any server and contains no analytics, ads, or trackers. It does not make its own network requests; it only reads data the page is already sending and receiving. It does not read passwords, direct messages, cookies, or credentials. It uses no remotely hosted code.

**Permissions.** `storage` (settings and history) and content scripts on `x.com` / `twitter.com`.

**Contact.** Open an issue at https://github.com/yaohongan/x-follower-lens/issues
