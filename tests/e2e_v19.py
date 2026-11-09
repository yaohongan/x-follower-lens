"""v0.19 三个功能:账号状态(徽标小点 + 悬停卡)、评论区大 V 高亮/低质量淡化、粉丝构成(列表页统计条 + 面板)。
运行:python3 tests/e2e_v19.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f,g=100,**extra):
    u={"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g}}
    u.update(extra); return u
def tw(i,u,v=1000,age=2): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":u}}}
def art(i,h): return f'''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time>2h</time></a></div></div></div></div><div style="display:flex;width:40px"><button>m</button></div></div><div role="group"><div><a href="/{h}/status/{i}/analytics">1</a></div></div></div></article>'''
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)

# ---- 1+2:同一个详情页里放主推文 + 几条回复(含账号状态各种情况)----
U={"main":user("mainguy",2000),
   "risky":user("riskyguy",500,fake=1,profile_metadata={"profile_interstitial_type":"fake_account"}),
   "prot":user("protguy",800,privacy={"protected":True}),
   "bigv":user("bigvguy",50000,100,is_blue_verified=True,verification_info={"is_identity_verified":True,"reason":{"verified_since_msec":"1781450372187"}},parody_commentary_fan_label="Parody"),
   "farm":user("farmguy",1500,1500),
   "clean":user("cleanguy",600,300)}
for k in U: U[k].pop("fake",None)
tweets=[tw(100,U["main"]),tw(101,U["risky"]),tw(102,U["prot"]),tw(103,U["bigv"]),tw(104,U["farm"]),tw(105,U["clean"])]
page_data=json.dumps({"data":tweets})
DETAIL='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps("".join(art(100+i,h) for i,h in enumerate(["mainguy","riskyguy","protguy","bigvguy","farmguy","cleanguy"])))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/TweetDetail");x.send()})</script></body></html>'

# ---- 3:粉丝列表页 ----
fol=[]
fans_spec=[(100,50)]*5+[(2500,300)]*3+[(5000,400)]*4+[(15000,300)]*3+[(40000,100)]*2+[(70000,100)]*1+[(200000,50)]*1+[(1500,1500)]*2   # 共 21 位
for i,(f,g) in enumerate(fans_spec): fol.append(user(f"fan{i}",f,g))
owner=user("owneruser",21000,300)
fol_data=json.dumps({"data":{"owner":owner,"list":fol}})
FOL='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div data-testid="primaryColumn"><div id="sticky" style="position:sticky;top:0;background:#fff"><div role="tablist"><div role="tab">认证关注者</div><div role="tab">关注者</div></div></div><div id=cells>cells</div></div><script>addEventListener("load",function(){var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/Followers");x.send();var y=new XMLHttpRequest();y.open("GET","/i/api/graphql/h/SidebarUserRecommendations");y.send()})</script></body></html>'
rec_data=json.dumps({"data":[user("recommended1",9999),user("recommended2",8888)]})

with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":900})
    def api(r):
        u=r.request.url
        body=fol_data if u.endswith("/Followers") else rec_data if "SidebarUser" in u else page_data
        r.fulfill(status=200,content_type="application/json",body=body)
    ctx.route("https://x.com/i/api/**",api)
    ctx.route("https://x.com/mainguy/status/100",lambda r:r.fulfill(status=200,content_type="text/html",body=DETAIL))
    ctx.route("https://x.com/owneruser/followers",lambda r:r.fulfill(status=200,content_type="text/html",body=FOL))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/mainguy/status/100"); pg.wait_for_timeout(2500)

    dots=pg.evaluate("[...document.querySelectorAll('article')].map(a=>{const d=a.querySelector('.fl-badge .fl-dot');return d?d.className:null})")
    check("账号状态:带「疑似虚假账号」提示的 → 红点;受保护的(只是信息)→ 没有点;干净的 → 没有点",dots[1]=="fl-dot r2" and dots[2] is None and dots[5] is None,dots)
    def tip(sel):
        pg.mouse.move(2,2); pg.hover(sel); pg.wait_for_timeout(300)
        return pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText.replace(/\\n/g,' | '):null})()")
    t1=tip('article:nth-of-type(2) .fl-badge'); check("悬停卡:有「账号状态」栏,写出人话(疑似虚假账号提示)",t1 and "账号状态" in t1 and "疑似虚假账号" in t1,t1)
    t2=tip('article:nth-of-type(3) .fl-badge'); check("受保护账号:悬停卡写「受保护账号」",t2 and "受保护账号" in t2,t2)
    t3=tip('article:nth-of-type(4) .fl-badge'); check("身份认证 + 恶搞号:写「已通过身份认证 · 自 2026-06」和「恶搞账号」",t3 and "身份认证" in t3 and "自 2026-06" in t3 and "恶搞账号" in t3,t3)
    t4=tip('article:nth-of-type(6) .fl-badge'); check("干净的账号:写「没发现风险标记」",t4 and "没发现风险标记" in t4,t4)
    pg.mouse.move(2,2)

    cls=pg.evaluate("[...document.querySelectorAll('article')].map(a=>[a.classList.contains('fl-vip'),a.classList.contains('fl-dimreply')])")
    check("评论区:大 V(5 万粉,关注 100)的回复高亮;主推文本身不高亮;低质量默认不淡化",cls[3]==[True,False] and cls[0]==[False,False] and all(not c[1] for c in cls),cls)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:评论区高亮默认开、淡化默认关、粉丝统计条默认开",pop.evaluate("(()=>{const q=k=>document.querySelector('input[data-key='+k+']').checked;return q('replyMark')&&!q('replyDim')&&q('fansBar')})()"))
    pop.click('input[data-key=replyDim]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    cls=pg.evaluate("[...document.querySelectorAll('article')].map(a=>a.classList.contains('fl-dimreply'))")
    check("打开淡化:疑似互粉号的回复变淡,大 V 和干净账号不淡",cls[4] is True and cls[3] is False and cls[5] is False,cls)
    pop.bring_to_front(); pop.click('input[data-key=replyMark]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关掉高亮:大 V 回复不再高亮",pg.evaluate("!document.querySelector('article.fl-vip')"))
    pop.bring_to_front(); pop.click('input[data-key=replyMark]'); pop.click('input[data-key=replyDim]'); pop.wait_for_timeout(300)

    # ---- 粉丝构成 ----
    fp=ctx.new_page(); fp.on("pageerror",lambda e:errs.append(str(e)))
    fp.goto("https://x.com/owneruser/followers"); fp.wait_for_timeout(2500)
    bar=fp.evaluate("(()=>{const b=document.querySelector('.fl-fans-bar');return b?{t:b.innerText.replace(/\\n/g,' | '),afterTabs:b.previousElementSibling.id==='sticky'}:null})()")
    check("粉丝列表页:标签栏所在的 sticky 头部后面出现统计条,写「已统计 21 / 21,000 位粉丝」(只统计 Followers 接口的用户,不含侧栏推荐)",bar and bar["afterTabs"] and "已统计 21" in bar["t"] and "21,000" in bar["t"],bar)
    fp.click('.fl-fans-bar button'); fp.wait_for_timeout(500)
    panel=fp.evaluate("(()=>{const m=document.getElementById('fl-fans-modal');if(!m)return null;return {t:m.innerText.replace(/\\n/g,' | '),keys:[...m.querySelectorAll('.fl-fans-k b')].map(e=>e.textContent),bands:[...m.querySelectorAll('.fl-fans-band .c')].map(e=>e.firstChild.textContent+'')}})()")
    print(panel and panel["t"][:300])
    # 21 位:<3000 = 5+3+2(1500 的互粉号) = 10;3000-1万 = 4;1万-3万 = 3;3万-5万 = 2;5万-10万 = 1;≥10万 = 1;≥3000 = 11、≥1万 = 7、≥3万 = 4
    check("面板:6 档人数对(<3000:10 / 3000–1万:4 / 1万–3万:3 / 3万–5万:2 / 5万–10万:1 / ≥10万:1)",panel and panel["bands"]==["10","4","3","2","1","1"],panel and panel["bands"])
    check("面板:关键数字 ≥3000=11、≥1万=7、≥3万=4",panel and panel["keys"]==["11","7","4"],panel and panel["keys"])
    check("面板:写明覆盖率和\"只统计滚动加载过的\"",panel and "只统计你已经" in panel["t"] and "21 / 21,000" in panel["t"],panel and panel["t"][:160])
    fp.click('.fl-fans-band:nth-child(4)'); fp.wait_for_timeout(300)
    lst=fp.evaluate("[...document.querySelectorAll('.fl-fans-list a')].map(a=>a.textContent)")
    check("点「3万–5万」:列出这一档的 2 位账号(@fan 开头,带粉丝数)",len(lst)==2 and all(x.startswith("@fan") for x in lst),lst)
    fp.click('.fl-fans-foot button.ghost:nth-last-child(2)'); fp.wait_for_timeout(500)
    check("清除这个账号的统计:面板关闭,统计条回到提示语",fp.evaluate("!document.getElementById('fl-fans-modal')") and "往下滚动" in fp.evaluate("document.querySelector('.fl-fans-bar').innerText"))
    # 分档线自定义
    pop.bring_to_front(); pop.fill('#fansLines','2000,3万'); pop.wait_for_timeout(700)
    fp.bring_to_front(); fp.reload(); fp.wait_for_timeout(2500)
    fp.click('.fl-fans-bar button'); fp.wait_for_timeout(400)
    names=fp.evaluate("[...document.querySelectorAll('.fl-fans-band .n')].map(e=>e.textContent)")
    check("自定义分档线「2000,3万」:3 档 < 2000 / 2000 – 3万 / ≥ 3万",names==["< 2000","2000 – 3万","≥ 3万"],names)
    fp.keyboard.press("Escape"); fp.wait_for_timeout(200)
    check("按 Esc 关闭面板",fp.evaluate("!document.getElementById('fl-fans-modal')"))
    # 非粉丝页没有统计条
    pg.bring_to_front()
    check("详情页上没有粉丝统计条",pg.evaluate("!document.querySelector('.fl-fans-bar')"))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
