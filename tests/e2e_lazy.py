"""性能相关的行为测试:
 1) 无关接口(通知数、私信设置这类)的响应不转发给内容脚本;有粉丝数的接口才转发
 2) 只给屏幕附近(上下各 600px)的推文装饰;远处的不装饰,滚到附近才装饰
 3) 自我计时(<html data-fl-perf>)在工作
运行:python3 tests/e2e_lazy.py"""
import json, tempfile, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
def user(h,fol): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":fol,"following":100}}
N=40
users=[user(f"u{i}",1000+i) for i in range(N)]
data=json.dumps({"data":{"items":users}})
def art(i): return f'<article data-testid="tweet" style="position:relative;width:548px;height:120px;border-bottom:1px solid #ddd"><div style="display:flex;flex-direction:column;flex:1 1 0"><div style="display:flex;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/u{i}">u{i}</a></div><div><a role="link" href="/u{i}">@u{i}</a></div></div></div></div><div style="display:flex;width:46px"><button>m</button></div></div></div></article>'
HTML=f'<!doctype html><html><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){{document.getElementById("r").innerHTML={json.dumps("".join(art(i) for i in range(N)))};var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()}});</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    has=lambda i: pg.evaluate(f"!!document.querySelectorAll('article')[{i}].querySelector('.fl-badge')")
    check("屏幕上的推文(第 1 条)有徽标",has(0))
    check("屏幕附近(600px 内)的推文(第 6 条)有徽标",has(5))
    check("远处的推文(第 30 条、第 40 条)没有装饰 —— 用户看不到,不浪费",(not has(29)) and (not has(39)),[has(29),has(39)])
    pg.evaluate("window.scrollTo(0,document.body.scrollHeight)"); pg.wait_for_timeout(900)
    check("滚到底后,最后一条在 0.9 秒内被装饰上",has(39))
    check("滚走之后,第 1 条仍保留装饰(不会闪掉)",has(0))
    # 自我计时 + 无关接口不转发
    pg.wait_for_timeout(2300)
    perf=lambda: json.loads(pg.evaluate("document.documentElement.dataset.flPerf||'{}'"))
    p0=perf(); check("自我计时在工作(记录了数据包数和耗时)",p0.get("packets",0)>=1 and "totalMs" in p0,p0)
    pg.evaluate("(()=>{const x=new XMLHttpRequest();x.open('GET','/i/api/graphql/a/ViewerBadgeCounts');x.send();const y=new XMLHttpRequest();y.open('GET','/i/api/graphql/a/DataSaverMode');y.send()})()"); pg.wait_for_timeout(2400)
    p1=perf(); check("无关接口(ViewerBadgeCounts / DataSaverMode)的响应不转发,数据包数不变",p1["packets"]==p0["packets"],(p0["packets"],p1["packets"]))
    pg.evaluate("(()=>{const x=new XMLHttpRequest();x.open('GET','/i/api/graphql/a/UserTweets');x.send()})()"); pg.wait_for_timeout(2400)
    p2=perf(); check("时间线类接口(UserTweets)照常转发",p2["packets"]==p1["packets"]+1,(p1["packets"],p2["packets"]))
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
