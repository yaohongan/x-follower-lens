"""破圈倍数测试:浏览量超过粉丝数才在流速标上显示"破圈 N×";悬停卡总会写出;设置里可关;封顶;粉丝数未知不算。
运行:python3 tests/e2e_reach.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":10}}
def tw(i,h,f,v): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(2)},"core":{"user_results":{"result":user(h,f)}}}
# 账号, 粉丝, 浏览量:  small 100 粉丝 / 5000 浏览 = 50×;mid 1000/1800 = 1.8×;big 50000/900 = 0.018×;huge 10/5000 = 500×(封顶);zero 0 粉丝
cases=[("small",100,5000),("mid",1000,1800),("big",50000,900),("huge",10,5000),("zero",0,5000)]
data=json.dumps({"data":[tw(i+1,h,f,v) for i,(h,f,v) in enumerate(cases)]})
def art(i,h): return f'''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-{h}" style="width:40px;height:40px;flex:none"><div style="border-radius:9999px;width:40px;height:40px;background:#999"><img style="width:40px;height:40px"></div></div><div style="flex:1;min-width:0;display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a></div></div></div></div><div style="display:flex;margin-left:auto;gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div><div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/{h}/status/{i}/analytics">1</a></div></div></div></div></article>'''
HTML='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps("".join(art(i+1,h) for i,(h,f,v) in enumerate(cases)))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()})</script></body></html>'
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
    check("粉丝 100 / 浏览 5000:显示「◎◎◎ 全网 50×」",t[0] and "全网 50×" in t[0],t[0])
    check("粉丝 1000 / 浏览 1800:显示「破圈 1.8×」",t[1] and "破圈 1.8×" in t[1],t[1])
    check("粉丝 5 万 / 浏览 900(0.018×):不显示破圈,但流速标还在",t[2] and "破圈" not in t[2] and "/h" in t[2],t[2])
    check("粉丝 10 / 浏览 5000(500×):封顶显示「≥100×」",t[3] and "全网 ≥100×" in t[3],t[3])
    check("粉丝数是 0:不算破圈,流速标照常",t[4] and "破圈" not in t[4] and "/h" in t[4],t[4])
    pg.hover('article:nth-of-type(1) .fl-flow'); pg.wait_for_timeout(400)
    card=pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText:null})()")
    check("悬停卡写出破圈倍数和算法",card and "破圈倍数" in card and "50×" in card and "累计被看 ÷ 作者粉丝数" in card,card and card.replace(chr(10)," | "))
    pg.mouse.move(2,2); pg.hover('article:nth-of-type(3) .fl-flow'); pg.wait_for_timeout(400)
    card3=pg.evaluate("(()=>{const x=document.getElementById('fl-tip');return x&&x.style.display!=='none'?x.innerText:null})()")
    check("没破圈的(<0.1×)悬停卡也写出,并说明还在粉丝圈里",card3 and "破圈倍数" in card3 and "粉丝圈" in card3,card3 and card3.replace(chr(10)," | "))
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:破圈倍数开关默认开",pop.evaluate("document.querySelector('input[data-key=flowReach]').checked"))
    pop.click('input[data-key=flowReach]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1500)
    t=T(); check("关掉开关:标上不再有破圈,悬停卡仍有",all("破圈" not in (x or "") for x in t),t)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
