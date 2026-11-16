# -*- coding: utf-8 -*-
"""引用推文:外层推文只有 10 次曝光,里面引用的那条有大量曝光。流速标必须按外层推文自己算,不能取引用那条的数据。
同时验证:样本太少(刚发几分钟、曝光几十次)不会被放大成高档位。运行:python3 tests/e2e_quote.py"""
import json, tempfile, time, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM")
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def U(h,f): return {"__typename":"User","rest_id":h+"1","core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":100}}
def T(i,views,h,u): return {"__typename":"Tweet","rest_id":i,"views":{"count":str(views)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(h)},"core":{"user_results":{"result":u}}}
data=json.dumps({"data":[T("7",10,3,U("small",500)),T("8",900000,0.5,U("big",900000)),T("9",30,2/60,U("small2",500))]})
BASE=ART='''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-yihui" style="width:40px;height:40px;flex:none"><div style="border-radius:9999px;width:40px;height:40px;background:#999"><img style="width:40px;height:40px"></div></div>
<div style="flex:1;min-width:0;display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/yihui">Yihui</a></div><div><a role="link" href="/yihui">@yihui</a></div></div></div></div>
<div style="display:flex; gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div>
<div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/yihui/status/7/analytics">4940</a></div></div></div></div></article>'''
ART1=BASE.replace('yihui','small').replace('/small/status/7/analytics','/small/status/7/analytics').replace('<div role="group"','<div data-testid="quoteTweet" role="link"><a href="/big/status/8">big 的推文</a></div><a href="/small/status/7"><time datetime="2026-11-16T00:00:00Z">3小时</time></a><div role="group"')
ART2=BASE.replace('yihui','small2').replace('/small2/status/7/analytics','/small2/status/9/analytics').replace('<div role="group"','<a href="/small2/status/9"><time datetime="2026-11-16T00:00:00Z">刚刚</time></a><div role="group"')
def page(art):
    return '<!doctype html><html><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps(art)+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/TweetDetail");x.send()});</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; print(("PASS " if c else "FAIL ")+n,e if not c else ""); ok&=bool(c)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":400})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    def run(art):
        pg=ctx.new_page(); pg.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=page(art)))
        pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
        t=pg.evaluate("(()=>{const c=document.querySelector('.fl-flow');return c?c.textContent:null})()"); pg.close(); return t
    t=run(ART1)
    check("引用了大号推文的小号推文:流速标按它自己(10 次/3 小时)算,不是 喷发/沸腾",t is not None and "喷发" not in t and "沸腾" not in t and "涌浪" not in t,t)
    t=run(ART2)
    check("刚发 2 分钟、30 次曝光:样本太少,不给 喷发/沸腾",t is None or ("喷发" not in t and "沸腾" not in t),t)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
