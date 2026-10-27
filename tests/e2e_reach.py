"""破圈倍数标测试:标上显示「图标 档名 N×」(5 档);封顶;粉丝数未知退回显示浏览量;6 小时内 ≥3× 补 ↗;悬停卡。
运行:python3 tests/e2e_reach.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":10}}
def tw(i,h,f,v,age=2): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":user(h,f)}}}
# 账号, 粉丝, 浏览量:  small 100 粉丝 / 5000 浏览 = 50×;mid 1000/1800 = 1.8×;big 50000/900 = 0.018×;huge 10/5000 = 500×(封顶);zero 0 粉丝
cases=[("small",100,5000,2),("mid",1000,1800,2),("big",50000,900,2),("huge",10,5000,2),("zero",0,5000,2),("hotone",1000,5000,2),("oldone",1000,5000,30),("near",1000,600,2),("mild",1000,200,2)]
data=json.dumps({"data":[tw(i+1,h,f,v,ag) for i,(h,f,v,ag) in enumerate(cases)]})
def art(i,h): return f'''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-{h}" style="width:40px;height:40px;flex:none"><div style="border-radius:9999px;width:40px;height:40px;background:#999"><img style="width:40px;height:40px"></div></div><div style="flex:1;min-width:0;display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a></div></div></div></div><div style="display:flex;margin-left:auto;gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div><div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/{h}/status/{i}/analytics">1</a></div></div></div></div></article>'''
HTML='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps("".join(art(i+1,h) for i,(h,f,v,ag) in enumerate(cases)))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()})</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    T=lambda: pg.evaluate("[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('.fl-flow');return c?c.textContent.trim():null})")
    t=T(); print(t)
    check("粉丝 100 / 浏览 5000:「🌍 全网 50×」",t[0] and t[0].startswith("🌍 全网 50×"),t[0])
    check("粉丝 1000 / 浏览 1800:「🌀 破圈 1.8×」,倍数不到 3,没有 ↗",t[1] and t[1]=="🌀 破圈 1.8×",t[1])
    check("粉丝 5 万 / 浏览 900(0.018×):只留图标「🫧」",t[2]=="🫧",t[2])
    check("0.6×(快出圈了):写全「🫧 圈内 0.6×」;0.2×:只写「🫧 0.2×」",t[7]=="🫧 圈内 0.6×" and t[8]=="🫧 0.2×",(t[7],t[8]))
    check("粉丝 10 / 浏览 5000(500×):封顶「≥100×」",t[3] and "全网 ≥100×" in t[3],t[3])
    check("粉丝数是 0:算不了倍数,退回显示浏览量「👁 浏览 5000」,不出现 /h",t[4] and "👁" in t[4] and "5000" in t[4] and "/h" not in t[4] and "×" not in t[4],t[4])
    check("5 档:🫧 🌀 🌊 🔥 🌍 的档位类名 f0..f4(同一套配色/动效)",pg.evaluate("[...document.querySelectorAll('.fl-flow')].map(c=>c.className.match(/f\\d/)[0]).join()")=="f4,f1,f0,f4,f0,f2,f2,f0,f0",pg.evaluate("[...document.querySelectorAll('.fl-flow')].map(c=>c.className).join('|')"))
    check("6 小时内且 ≥3×:补一个 ↗(还在往外传);≥3× 但发出 30 小时的不补",t[5] and "↗" in t[5] and t[6] and "↗" not in t[6] and t[6].startswith("🌊"),(t[5],t[6]))
    pg.hover('article:nth-of-type(1) .fl-flow'); pg.wait_for_timeout(400)
    card=pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText:null})()")
    check("悬停卡:破圈倍数放第一行,写出算法、圈子刻度,保留每小时被看,说明 ↗ 的含义",card and all(k in card for k in ("破圈倍数","50×","累计被看 ÷ 作者粉丝数","圈子刻度","平均每小时被看","6 小时内")),card and card.replace(chr(10)," | "))
    pg.mouse.move(2,2); pg.hover('article:nth-of-type(3) .fl-flow'); pg.wait_for_timeout(400)
    card3=pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText:null})()")
    check("只有图标的悬停卡:标题「圈内 · 还在粉丝圈里」,仍写出具体倍数",card3 and "圈内 · 还在粉丝圈里" in card3 and "<0.1×" in card3,card3 and card3.replace(chr(10)," | "))
    pg.mouse.move(2,2); pg.hover('article:nth-of-type(5) .fl-flow'); pg.wait_for_timeout(400)
    card5=pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText:null})()")
    check("拿不到粉丝数的悬停卡:说明算不了破圈倍数",card5 and "拿不到作者粉丝数" in card5,card5 and card5.replace(chr(10)," | "))
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:没有「破圈倍数」「计算口径」两个旧选项了",pop.evaluate("document.querySelectorAll('input[data-key=flowReach],input[data-key=flowMode]').length")==0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
