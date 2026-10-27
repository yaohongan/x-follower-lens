"""流速标(新说法)测试:标上写「图标 档名 N/分」(每分钟被看,5 档,与粉丝数无关);悬停卡里「比 TA 平时」。
运行:python3 tests/e2e_reach.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":10}}
# 同一作者 star:3 条发出两天的老推文(浏览 1000/2000/3000,中位数 2000)+ 1 条 2 小时前的新推文(浏览 6000 → 已是平时的 3 倍)
# 另一作者 solo:只有 1 条,没有历史 → 悬停卡里没有"比 TA 平时"
def tw(i,h,v,age): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":user(h,100000 if h=="star" else 50)}}}
cases=[("star",6000,2),("star",1000,48),("star",2000,50),("star",3000,60),("solo",6000,2),("tiny",5,2),("mid",300,2),("star",1500,70)]
data=json.dumps({"data":[tw(i+1,h,v,a) for i,(h,v,a) in enumerate(cases)]})
def art(i,h): return f'''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-{h}" style="width:40px;height:40px;flex:none"><div style="border-radius:9999px;width:40px;height:40px;background:#999"><img style="width:40px;height:40px"></div></div><div style="flex:1;min-width:0;display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a></div></div></div></div><div style="display:flex;margin-left:auto;gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div><div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/{h}/status/{i}/analytics">1</a></div></div></div></div></article>'''
HTML='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps("".join(art(i+1,h) for i,(h,v,ag) in enumerate(cases)))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()})</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":900})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    T=lambda: pg.evaluate("[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('.fl-flow');return c?c.textContent.trim():null})")
    t=T(); print(t)
    check("6000 浏览/2 小时=3000/小时:「🌋 喷发 50/分」,没有 /h、没有 × 倍数",t[0]=="🌋 喷发 50/分",t[0])
    check("和粉丝数无关:粉丝 10 万的号和粉丝 50 的号,同样速度显示同样的档(第 5 条 solo 也是 🌋 50/分)",t[4]=="🌋 喷发 50/分",t[4])
    check("5 浏览/2 小时:「🌱 萌芽 <1/分」",t[5]=="🌱 萌芽 <1/分",t[5])
    check("300 浏览/2 小时=150/小时:「🌊 涌浪 2.5/分」",t[6]=="🌊 涌浪 2.5/分",t[6])
    check("老推文(发出两天)也显示,且不带箭头",t[1] and "↗" not in t[1] and "/分" in t[1],t[1])
    tip=lambda sel:(pg.mouse.move(2,2),pg.hover(sel),pg.wait_for_timeout(400),pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText.replace(/\\n/g,' | '):null})()"))[-1]
    c0=tip('article:nth-of-type(1) .fl-flow')
    check("悬停卡:每分钟被看 50 次;比 TA 平时「已是 3.4 倍」(中位数 1750)(新推文不到一天,所以说还在涨);写明平时是怎么算的",c0 and "每分钟被看" in c0 and "50 次" in c0 and "已是 3.4 倍" in c0 and "还在涨" in c0 and "中位数" in c0 and "4 条" in c0,c0)
    c4=tip('article:nth-of-type(5) .fl-flow')
    check("没有历史样本的作者:悬停卡里没有「比 TA 平时」",c4 and "比 TA 平时" not in c4,c4)
    c1=tip('article:nth-of-type(2) .fl-flow')
    check("发出两天的老推文:「比 TA 平时」不写还在涨",c1 and "比 TA 平时" in c1 and "还在涨" not in c1,c1)
    check("悬停卡里不再出现破圈倍数/圈内/粉丝",all(k not in c0 for k in ("破圈","圈内","作者粉丝")),c0)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:没有「破圈倍数」「计算口径」旧选项",pop.evaluate("document.querySelectorAll('input[data-key=flowReach],input[data-key=flowMode]').length")==0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
