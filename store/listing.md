# Chrome Web Store 上架材料(逐项复制粘贴)

## 一、商品详情(Store listing)

**名称(Name)**
粉丝透镜 Follower Lens

**摘要(Summary,≤132 字符)**
在 X 信息流里显示推文流速、头像流速环和内容方向标签,还能一键生成账号名片;同时显示粉丝数和质量标签。

**类别(Category)**:工具 / Tools(或"社交与通讯")

**语言(Language)**:中文(简体)。如需英文版见下方英文文案。

**详细说明(Description,中文)**
```
X 不直接显示别人的粉丝数,也看不出一条推文到底火没火。粉丝透镜把这些直接放到信息流里:

【主要功能】
• 推文流速:标出每条推文每分钟被看多少次,萌芽 / 起风 / 涌浪 / 沸腾 / 喷发 五档(如 🔥 沸腾 17/分),和账号粉丝多少无关,带 ↗↘ 升温降温趋势;鼠标放上去看累计浏览、发布多久,以及比这位作者平时快几倍
• 头像流速环:作者头像按这条推文的流速加一圈环,每一档一个造型(默认静态,不晃眼;设置里可以让它转起来)
• 内容方向标签:按账号简介和刷到的推文,标出这个博主主要做什么(AI编程、智能体、AI视频、AI设计、出海变现、投资……),每个方向一种颜色,词典可自定义
• 账号名片:在个人主页一键生成带头像、主页地址和"粉丝质量指数"的图片,三种风格,可下载或复制后直接发到 X
• 粉丝数徽标:信息流、关注列表、粉丝列表里,每个账号旁边直接显示粉丝数
• 质量标签:互关 / 关注了你 / 大V / 高互动 / 低活跃 / 疑似互粉号 / 新号 / 老号
• 悬停详情卡:精确粉丝数、关注数、粉丝/关注比、推文数、注册时间、互动率
• 粉丝数变化:在你的浏览器本地记录你刷到过的账号,显示"近 7 天涨了多少"
• 自适应布局:不遮挡时间、订阅按钮;头部太挤时自动换行;设置面板里每个功能都能单独开关

【隐私】
• 不收集、不上传、不出售任何数据,没有统计和广告代码
• 只读取 X 网页自己已经收到的数据,不主动发出数据请求;唯一的例外:你点"生成账号名片"时会读取该账号的头像图片(来自 X 自己的图片服务器),只用于在本地画图
• 设置和粉丝数历史只保存在你浏览器本地,可随时在设置面板里清除
• 开源:https://github.com/yaohongan/x-follower-lens

【说明】
流速、标签和"粉丝质量指数"都是用公开数字做的估算,仅供参考,不代表内容或账号的质量。本扩展是个人开发的非官方工具,与 X Corp. 无关。X 改版后可能需要更新。
```

**Description (English)**
```
X doesn't show other people's follower counts, and you can't tell how fast a post is taking off. Follower Lens puts that right in your timeline:

FEATURES
• Post velocity: views per hour, in five tiers (Turtle / Bicycle / Scooter / Rocket / Lightspeed) with the number and an up/down trend; hover for views, post age and how it is calculated
• Avatar velocity ring: a ring around the author's avatar, one look per tier (static by default; optional spinning in settings)
• Topic tags: guesses what a creator mainly posts about from their bio and the posts you have seen (AI coding, agents, AI video, AI design, indie business, investing...), color-coded, with a custom dictionary
• Account card: one click on a profile creates an image with the avatar, profile link and a "follower quality index"; three styles; download or copy it
• Follower count badge in the timeline, following lists and follower lists
• Quality tags: mutual / follows you / big account / high engagement / low activity / suspected follow-for-follow / new / veteran
• Hover card: exact followers, following, ratio, post count, account age, engagement rate
• Follower change: recorded locally for accounts you browse, shows the last 7 days
• Adaptive layout that avoids covering timestamps and buttons; every feature has its own switch

PRIVACY
• Collects, uploads and sells nothing. No analytics, ads or trackers.
• Reads only data the X web page has already received and makes no data requests of its own. The one exception: when you click "create account card", it loads that account's avatar image (from X's own image server) just to draw the card locally.
• Settings and follower history stay in your browser and can be cleared at any time.
• Open source: https://github.com/yaohongan/x-follower-lens

Velocity, tags and the quality index are estimates from public numbers, for reference only. This is an unofficial personal project, not affiliated with X Corp.
```

**图标**:`icons/icon128.png`(128×128,已包含在安装包里,商店要求单独再上传一次)
**截图**:`store/screenshot-1.png` … `screenshot-5.png`(1280×800,共 5 张,最多可传 5 张)
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
| 内容脚本(x.com、twitter.com;含"生成账号名片"时读取头像图片) | 扩展只在 x.com 和 twitter.com 运行。它读取 X 网页自己已经收到的数据(用户名、粉丝数、关注数、注册时间、互动数),并在页面上显示徽标。不读取任何其它网站。 |

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
