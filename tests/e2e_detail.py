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
<div style="display:flex;MENUSTYLE gap:8px"><button style="width:30px">g</button><button style="width:30px">m</button></div></div>
<div role="group" style="display:flex"><div style="display:flex;width:300px"><a role="link" href="/yihui/status/7/analytics">4940</a></div></div></div></div></article>'''
def mk(menu): return '<!doctype html><html><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps(ART.replace('MENUSTYLE',menu))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/TweetDetail");x.send()});</script></body></html>'
ok=True
VARIANTS={"真实页面:菜单里有个 visibility:hidden 但占位的按钮(被隐藏的别家流速标)":"REAL","图标组晚渲染(1.5 秒后才出现,先是空的)":"LATE","图标组带 margin-left:auto":"margin-left:auto;","图标组 flex:1 撑满剩余空白、内容右对齐(真实页面的情形)":"flex:1;justify-content:flex-end;"}
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":400})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    for name,menu in VARIANTS.items():
        pg=ctx.new_page(); late=(menu=="LATE"); body=mk("flex:1;justify-content:flex-end;" if late else ("margin-left:auto;" if menu=="REAL" else menu))
        if menu=="REAL": body=body.replace('<button style="width:30px">g</button>','<button style="width:54px;visibility:hidden">h</button><button style="width:30px">g</button>')
        if late:
            body=body.replace('<button style="width:30px">g</button><button style="width:30px">m</button>','')
            js="setTimeout(function(){var m=document.querySelector('[data-testid=User-Name]').parentElement.parentElement.nextElementSibling;m.innerHTML='<button style=width:30px>g</button><button style=width:30px>m</button>'},1800)"
            body=body.replace("</body>","<script>"+js+"</script></body>")
        pg.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=body))
        pg.goto("https://x.com/home"); pg.wait_for_timeout(2500 if not late else 6500)
        r=pg.evaluate("(()=>{const c=document.querySelector('.fl-flow');if(!c)return null;const m=c.nextElementSibling.getBoundingClientRect(),b=c.getBoundingClientRect(),u=document.querySelector('[data-testid=User-Name]').getBoundingClientRect(),mn=c.nextElementSibling;const btn=[...mn.querySelectorAll('button')].find(x=>getComputedStyle(x).visibility!=='hidden').getBoundingClientRect();return {gapToIcons:Math.round(btn.left-b.right),place:c.dataset.flPlace}})()")
        good=r is not None and r["place"]=="h" and r["gapToIcons"]<=24
        print(("PASS " if good else "FAIL ")+"流速标靠右、贴着图标组:"+name,r); ok&=good
        pg.close()
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
