"""趋势箭头测试:同一条推文两次看到的浏览量相隔 ≥2 分钟,才会算"最近这一阵"的速度。
运行:python3 tests/e2e_trend.py   (要真实等待约 2 分 10 秒)"""
import json, tempfile, time, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
now=time.time()
ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
u={"__typename":"User","rest_id":"a","core":{"screen_name":"trendy","name":"trendy","created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":100000,"following":10}}
def tw(i,views): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(views)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(2)},"core":{"user_results":{"result":u}}}
state={"views":(1000,20000)}   # (推文1, 推文2)
def api(r):
    r.fulfill(status=200,content_type="application/json",body=json.dumps({"data":[tw(1,state["views"][0]),tw(2,state["views"][1])]}))
def art(i): return f'<article data-testid="tweet" style="position:relative;width:548px"><div style="display:flex;flex-direction:column;width:548px"><div style="display:flex;justify-content:space-between;width:518px"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/trendy">trendy</a></div><div><a role="link" href="/trendy">@trendy</a><a href="/trendy/status/{i}"><time>2h</time></a></div></div></div></div><div style="display:flex;width:46px"><button>m</button></div></div><div role="group"><div><a href="/trendy/status/{i}/analytics">1</a></div></div></div></article>'
HTML=f'<!doctype html><html><body style="margin:30px"><div id=r></div><script>function load(){{var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()}} window.addEventListener("load",function(){{document.getElementById("r").innerHTML={json.dumps(art(1)+art(2))};load()}});</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":500})
    ctx.route("https://x.com/i/api/**",api); ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    chip=lambda i:pg.evaluate(f"(()=>{{const c=document.querySelectorAll('article')[{i}].querySelector('.fl-flow');return c?{{t:c.textContent.trim(),title:c.title}}:null}})()")
    a0,a1=chip(0),chip(1); print(a0,a1)
    check("第一次看到:没有箭头",a0 and "↗" not in a0["t"] and "↘" not in a0["t"])
    # 1 分钟后:间隔太短,即使浏览量变了也不该有箭头
    pg.wait_for_timeout(60000); state["views"]=(1030,20010); pg.evaluate("load()"); pg.wait_for_timeout(1500)
    check("只隔 1 分钟:仍无箭头(防噪音)",not any(s in chip(0)["t"] for s in "↗↘"),chip(0)["t"])
    # 再等到距第一次 ≥ 2 分钟:推文1(平均 500/h)猛涨 → 升温;推文2(平均 1 万/h)2 分钟只涨 40 → 降温
    pg.wait_for_timeout(65000); state["views"]=(1000+60000,20000+40); pg.evaluate("load()"); pg.wait_for_timeout(2000)
    a0,a1=chip(0),chip(1); print(a0,a1)
    check("猛涨的推文:↗ 升温",a0 and "↗" in a0["t"],a0 and a0["t"])
    check("几乎不涨的推文:↘ 降温",a1 and "↘" in a1["t"],a1 and a1["t"])
    pg.hover('article:nth-of-type(1) .fl-flow'); pg.wait_for_timeout(400)
    card=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText:null})()")
    check("信息卡里说明了近段走势(越传越快)",card and "近段走势" in card and "越传越快" in card,card and card.replace(chr(10)," | "))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
