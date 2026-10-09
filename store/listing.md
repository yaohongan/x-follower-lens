# Chrome Web Store 上架材料(逐项复制粘贴)

## 一、商品详情(Store listing)

**名称(Name)**
粉丝透镜 Follower Lens

**摘要(Summary,≤132 字符)**
在 X(Twitter)信息流和关注列表里直接显示粉丝数,并给出互关、大V、互动率等质量标签。

**类别(Category)**:工具 / Tools(或"社交与通讯")

**语言(Language)**:中文(简体)。如需英文版见下方英文文案。

**详细说明(Description,中文)**
```
X 不直接显示别人的粉丝数。看到一个陌生账号,想知道它值不值得关注,得点进主页才行。
粉丝透镜把这一步省掉了:在 X 的信息流和关注列表里,直接在用户名旁边显示粉丝数,并告诉你这个账号大概是什么类型。

【主要功能】
• 粉丝数徽标:信息流、关注列表、粉丝列表里,每个账号旁边直接显示粉丝数(1万以内精确显示)
• 分级配色:按粉丝量分档上色,一眼分出量级
• 质量标签:互关 / 关注了你 / 大V / 高互动 / 低活跃 / 疑似互粉号 / 新号 / 老号
• 悬停详情卡:精确粉丝数、关注数、粉丝/关注比、推文数、注册时间、互动率
• 粉丝数变化:在你的浏览器本地记录你刷到过的账号,显示"近 7 天涨了多少"
• 列表淡化:在关注 / 粉丝列表里,把疑似互粉号和低活跃号淡化,更快找到值得关注的人
• 自适应布局:推文头部太挤时,徽标自动换到下一行,不会把名字挤坏
• 设置面板:每个功能、每种标签都能单独开关,改动即时生效

【适合谁】
想通过别人的"正在关注"列表找新账号的人;想知道哪些有影响力的人关注了自己的人;想快速判断陌生账号质量的人。

【隐私】
• 不收集、不上传、不出售任何数据,没有统计和广告代码
• 只读取 X 网页自己已经收到的数据,不主动发出任何网络请求
• 设置和粉丝数历史只保存在你浏览器本地,可随时在设置面板里清除
• 开源:https://github.com/yaohongan/x-follower-lens

【说明】
标签是辅助参考,粉丝数多少不代表内容质量。本扩展是个人开发的非官方工具,与 X Corp. 无关。X 改版后可能需要更新。
```

**Description (English)**
```
X does not show other people's follower counts directly. To judge an unfamiliar account you have to open its profile.
Follower Lens removes that step: it shows each account's follower count right next to the username in your timeline and in following/follower lists, plus tags that hint at what kind of account it is.

FEATURES
• Follower badge in the timeline, following lists and follower lists (exact numbers under 10K)
• Color tiers by follower size
• Quality tags: mutual / follows you / big account / high engagement / low activity / suspected follow-for-follow / new / veteran
• Hover card: exact followers, following, follower/following ratio, post count, account age, engagement rate
• Follower change: recorded locally for accounts you browse, shows the last 7 days
• Dim low-quality accounts in following / follower lists
• Adaptive layout: when the tweet header is crowded, the badge moves to its own line
• Settings popup: every feature and tag can be toggled, applied instantly

PRIVACY
• Collects, uploads and sells nothing. No analytics, ads or trackers.
• Reads only data the X web page has already received; makes no network requests of its own.
• Settings and follower history stay in your browser and can be cleared at any time.
• Open source: https://github.com/yaohongan/x-follower-lens

Tags are only hints; follower count does not equal content quality. This is an unofficial personal project, not affiliated with X Corp.
```

**图标**:`icons/icon128.png`(128×128,已包含在安装包里,商店要求单独再上传一次)
**截图**:`store/screenshot-1.png` … `screenshot-4.png`(1280×800)
**小宣传图(Small promo tile)**:`store/promo-440x280.png`(建议上传)

**主页 URL / 支持 URL**:https://github.com/yaohongan/x-follower-lens  /  https://github.com/yaohongan/x-follower-lens/issues

---

## 二、隐私规范(Privacy practices)——最容易卡住的一页

**单一用途说明(Single purpose)**
```
在 X(Twitter)网页上显示账号的粉丝数和质量标签,帮助用户判断账号。
```

**权限理由(Permission justification)**

| 项目 | 理由(粘贴) |
|---|---|
| storage | 保存用户的设置(各开关、徽标位置)以及用户本地的粉丝数历史记录,用于显示"近 7 天变化"。数据只保存在本地,不上传。 |
| 内容脚本(x.com、twitter.com) | 扩展只在 x.com 和 twitter.com 运行。它读取 X 网页自己已经收到的数据(用户名、粉丝数、关注数、注册时间、互动数),并在页面上显示徽标。不读取任何其它网站。 |

> 本扩展没有声明 `host_permissions`、`tabs`、`webRequest` 等权限,所以不需要为它们写理由。

**远程代码(Remote code)**:选 **No**,不使用远程托管代码。所有 JS 都在安装包里。

**数据使用披露(Data usage)**
- 你收集或使用下列任何用户数据吗? → 保守且准确的回答:
  - "网站内容(Website content)":扩展会读取页面上的公开账号数据,但只在本地使用、不传输、不存储在外部。商店表单对"收集"的定义是**传输出设备**,所以按"不收集"勾选;若表单让你勾选"处理"类别,选"网站内容"并说明仅本地使用。
  - 其它类别(个人身份信息、健康、金融、认证信息、位置、网页历史、用户活动等):全部**不勾选**。
- 三项承诺(Certifications)全部勾选:不向第三方出售用户数据;不将数据用于与单一用途无关的目的;不用于判定信用或贷款。

**隐私政策 URL**
```
https://github.com/yaohongan/x-follower-lens/blob/main/PRIVACY.md
```
(推送到 GitHub 之后这个链接才有效。)

---

## 三、分发(Distribution)
- 可见性(Visibility):公开(Public)。想先小范围试,可选"不公开(Unlisted)",拿到链接的人才能安装。
- 地区:所有地区。
- EU 贸易商声明(Trader):个人开发者、不以此盈利,选"非贸易商(Non-trader)"。

---

## 四、审核可能被问到的点
1. **为什么要改写页面的 fetch / XMLHttpRequest?** 答:只是在响应返回后,复制一份读取页面已收到的数据,不修改请求,不修改响应,不发出新请求。代码见 `inject.js`(约 30 行)。
2. **名称里有 X / Twitter?** 名称是"粉丝透镜 Follower Lens",没有使用 X 的名称或 Logo;描述里提到 X 仅为说明适用站点,并已声明与 X Corp. 无关。
3. **被 X 改版弄坏怎么办?** 字段解析集中在 `parse.js`,改版后更新版本即可。
