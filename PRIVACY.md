# 隐私政策 / Privacy Policy

**粉丝透镜 Follower Lens** · 最后更新:2026-11-08

## 中文

**一句话:这个扩展不收集、不上传、不出售你的任何数据。**

### 它会读取什么
扩展只在 `x.com` 和 `twitter.com` 运行。它读取的是 **X 网页自己已经收到的数据**(用户名、粉丝数、关注数、注册时间、推文互动数、你与对方的关注关系),用来在页面上显示徽标和悬停卡片。

### 它会保存什么
以下内容保存在你浏览器的本地存储(`chrome.storage.local`)里,不会离开你的设备:
- **你的设置**(各开关、徽标位置等)。
- **粉丝数历史记录**:你浏览过的账号的用户名与粉丝数、记录时间,用于显示"近 7 天变化"。最多保存 3000 个账号、每个账号 40 个数据点。你可以随时在扩展的设置面板里点"清除记录"删除,或关闭"本地记录粉丝数变化"。
- **粉丝构成样本（主动开启后）**:你填写的目标用户名、目标用户 ID、记录状态和时间，以及在其普通关注者页加载的粉丝 ID、用户名、显示名、简介、自填地区、粉丝/关注数、注册与采集时间。按用户 ID 去重，最多 5,000 人，并受本地存储大小上限约束；不自动淘汰旧样本。仅在你开启报告记录后保存，可在报告页暂停、导出或清除。关闭报告页不等于暂停：继续浏览目标关注者页仍可记录。清除报告与原有「清除记录」操作相互独立。

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

**What it stores.** The following is saved in your browser's local storage (`chrome.storage.local`) and never leaves your device: (1) your settings; (2) a follower-count history for accounts you have browsed (username, follower count, timestamp; capped at 3,000 accounts and 40 data points each) used to show 7-day changes. You can delete it anytime with "Clear history" in the extension popup, or turn history tracking off.

**Opt-in audience samples.** When you explicitly start recording in the audience report, the extension also stores the selected account handle/ID, recording state and timestamps, and follower IDs, handles, names, bios, self-reported locations, follower/following counts, account creation dates and observation times from that account's ordinary Followers page. Samples are deduplicated by user ID, capped at 5,000 people and bounded by local storage size. Closing the report does not pause recording while you continue browsing that Followers page. Pause, export or delete the sample from the report; this is separate from clearing the existing follower-count history. CSV exports are created locally and are downloaded only on your request. The report does not fetch additional X data and does not establish ownership of the handle you enter.

**What it does not do.** It sends no data to any server and contains no analytics, ads, or trackers. It does not make its own network requests; it only reads data the page is already sending and receiving. It does not read passwords, direct messages, cookies, or credentials. It uses no remotely hosted code.

**Permissions.** `storage` (settings and history) and content scripts on `x.com` / `twitter.com`.

**Contact.** Open an issue at https://github.com/yaohongan/x-follower-lens/issues
