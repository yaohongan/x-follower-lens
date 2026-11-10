"""X Pro(pro.x.com,多栏)也能用:插件要在 pro.x.com 上加载,读 /i/api/graphql/ 的数据,窄栏里放不下时逐级缩短,横向在屏幕外的栏提前装饰好。
运行:python3 tests/e2e_pro.py"""
import json, tempfile, time, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Chromium")
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f,g=100): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g},"tweet_counts":{"tweets":900}}
def tw(i,u,v): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":3,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(2),"full_text":"hi"},"core":{"user_results":{"result":u}}}
names=["aa_short","long_handle_nm1"]
us=[user(n,3000+i*9000) for i,n in enumerate(names)]
tweets=[tw(10+i,us[i%2],2000+i*500) for i in range(8)]
data=json.dumps({"data":tweets})
def art(i,h): return f'<article data-testid="tweet" style="position:relative;padding:10px;box-sizing:border-box;border-bottom:1px solid #ddd"><div style="display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex;min-width:0"><div style="display:flex;flex-direction:column;min-width:0"><div data-testid="User-Name" style="min-width:0"><div><a role="link" href="/{h}">{h} Display Name</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time> · 2h</time></a></div></div></div></div><div style="display:flex;width:40px"><button>m</button></div></div><div role="group"><div><a href="/{h}/status/{i}/analytics">1</a></div></div></div></article>'
# 4 栏,每栏 340px 宽,横向排列;前两栏在屏幕里,后两栏在屏幕右边外面(viewport 700px)
cols="".join(f'<div class="col" style="flex:none;width:340px;height:600px;overflow:auto;border-right:1px solid #ccc">'+"".join(art(10+c*2+k,names[(c+k)%2]) for k in range(2))+'</div>' for c in range(4))
HTML='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div style="display:flex;width:1400px">'+cols+'</div><script>addEventListener("load",function(){var x=new XMLHttpRequest();x.open("GET","https://pro.x.com/i/api/graphql/h/ListLatestTweetsTimeline");x.send()})</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    ctx.route("https://pro.x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://pro.x.com/i/decks/1",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    errs=[]; pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://pro.x.com/i/decks/1"); pg.wait_for_timeout(3000)
    S=pg.evaluate("[...document.querySelectorAll('article')].map(a=>({chip:a.querySelector('.fl-flow')?a.querySelector('.fl-flow').textContent.trim():null,badge:!!a.querySelector('.fl-badge')}))")
    check("pro.x.com 上插件加载了:前两栏(屏幕里)的推文都有流速标和粉丝徽标",all(x["chip"] and x["badge"] for x in S[:4]),S[:4])
    check("横向在屏幕外 600px 以内的栏(第三栏)也提前装饰好了",all(x["chip"] for x in S[4:6]),S[4:6])
    narrow=pg.evaluate("[...document.querySelectorAll('article')].slice(0,4).map(a=>{const c=a.querySelector('.fl-flow'),col=a.closest('.col').getBoundingClientRect(),un=a.querySelector('[data-testid=User-Name]');const r=c.getBoundingClientRect();return {inCol:r.right<=col.right+1&&r.left>=col.left-1,txt:c.textContent.trim()}})")
    check("窄栏(340px)里流速标不超出栏的边界",all(x["inCol"] for x in narrow),narrow)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
