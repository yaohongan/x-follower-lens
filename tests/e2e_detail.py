"""详情页头部:右边图标组自己带 margin-left:auto 时,流速标必须贴着图标组(不能被平分空白漂到中间)。
运行:python3 tests/e2e_detail.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
U={"__typename":"User","rest_id":"1","core":{"screen_name":"yihui","name":"Yihui","created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":63600,"following":100}}
data=json.dumps({"data":[{"__typename":"Tweet","rest_id":"7","views":{"count":"4940"},"legacy":{"favorite_count":22,"retweet_count":1,"reply_count":16,"quote_count":0,"created_at":ago(1)},"core":{"user_results":{"result":U}}}]})
ART='''<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-yihui" style="width:40px;height:40px;flex:none"><div style="border-radius:9999px;width:40px;height:40px;background:#999"><img style="width:40px;height:40px"></div></div>
<div style="flex:1;min-width:0;display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/yihui">Yihui</a></div><div><a role="link" href="/yihui">@yihui</a></div></div></div></div>
<div style="display:flex;margin-left:auto;gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div>
<div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/yihui/status/7/analytics">4940</a></div></div></div></div></article>'''
HTML='<!doctype html><html><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps(ART)+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/TweetDetail");x.send()});</script></body></html>'
ok=True
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":400})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    r=pg.evaluate("(()=>{const c=document.querySelector('.fl-flow');if(!c)return null;const m=c.nextElementSibling.getBoundingClientRect(),b=c.getBoundingClientRect(),u=document.querySelector('[data-testid=User-Name]').getBoundingClientRect();return {gapToMenu:Math.round(m.left-b.right),gapFromName:Math.round(b.left-u.right),place:c.dataset.flPlace}})()")
    c1=r is not None and r["place"]=="h" and 0<=r["gapToMenu"]<=14
    print(("PASS " if c1 else "FAIL ")+"流速标贴着右边图标组(间隙 ≤ 14px),不漂在中间",r); ok&=c1
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
