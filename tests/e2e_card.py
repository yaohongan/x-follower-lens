"""账号名片测试:个人主页出现按钮、点开画出名片、下载/复制、非主页没有、关闭开关、评分口径。
运行:python3 tests/e2e_card.py"""
import json, tempfile, time, hashlib, os, base64
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
U={"__typename":"User","rest_id":"9","core":{"screen_name":"coder","name":"代码老张","created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":23800,"following":310},"tweet_counts":{"tweets":5200},"profile_bio":{"description":"独立开发者,用 Cursor 和 Claude Code 写代码,AI编程每日分享"}}
def tw(i): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":"20000"},"legacy":{"favorite_count":900,"retweet_count":100,"reply_count":50,"quote_count":10,"created_at":ago(5),"full_text":"cursor 写代码"},"core":{"user_results":{"result":U}}}
data=json.dumps({"data":{"user":U,"tl":[tw(i) for i in range(1,6)]}})
HTML='''<!doctype html><html><body style="margin:20px;font:15px sans-serif"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='<div><div data-testid="UserAvatar-Container-coder" style="width:80px;height:80px"><img src="/av.png" style="width:80px;height:80px"></div><div data-testid="UserName"><b>代码老张</b> @coder</div><div data-testid="UserDescription">bio</div></div>';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/UserTweets");x.send()});</script></body></html>'''
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":900},accept_downloads=True)
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/av.png",lambda r:r.fulfill(status=200,content_type="image/png",body=PNG,headers={"access-control-allow-origin":"*"}))
    ctx.route("https://x.com/coder",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML.replace('data-testid="UserName"','data-testid="Other"')))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/coder"); pg.wait_for_timeout(2500)
    check("个人主页:出现「生成账号名片」按钮,且紧跟在用户名块后面",pg.evaluate("(()=>{const b=document.querySelector('.fl-card-btn');return !!b&&b.previousElementSibling.dataset.testid==='UserName'})()"))
    pg.click(".fl-card-btn"); pg.wait_for_timeout(1200)
    check("点开:出现弹层和画布",pg.evaluate("!!document.querySelector('#fl-card-modal canvas')"))
    info=pg.evaluate("(()=>{const c=document.querySelector('#fl-card-modal canvas');const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let nz=0;for(let i=0;i<d.length;i+=4*500)if(d[i]+d[i+1]+d[i+2]>60)nz++;return {w:c.width,h:c.height,nz,url:c.toDataURL('image/png')}})()")
    check("画布尺寸 1600×2360,且画了内容(不是空白)",info["w"]==1600 and info["h"]==2360 and info["nz"]>50,(info["w"],info["h"],info["nz"]))
    open(os.path.join(tempfile.gettempdir(),"shot_card.png"),"wb").write(base64.b64decode(info["url"].split(",")[1]))
    with pg.expect_download() as dl: pg.click('#fl-card-modal [data-a=dl]')
    check("下载图片:文件名带账号名",dl.value.suggested_filename=="粉丝透镜-coder.png",dl.value.suggested_filename)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("按 Esc 关闭弹层",pg.evaluate("!document.querySelector('#fl-card-modal')"))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2000)
    check("不是个人主页:没有按钮",pg.evaluate("!document.querySelector('.fl-card-btn')"))
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:生成名片按钮默认勾选",pop.evaluate("document.querySelector('input[data-key=cardBtn]').checked"))
    pop.click('input[data-key=cardBtn]'); pop.wait_for_timeout(300)
    pg.goto("https://x.com/coder"); pg.wait_for_timeout(2500)
    check("关闭开关:个人主页也没有按钮",pg.evaluate("!document.querySelector('.fl-card-btn')"))
    check("无页面报错",not errs,errs)
    ctx.close()
# 评分口径(纯函数)
import subprocess
js='''const P=require("%s/parse.js");const now=Date.now();
const u=(o)=>Object.assign({handle:"a",followers:1000,following:1000,tweets:200,createdAt:new Date(now-3*365*864e5).toISOString()},o);
const r=[P.qualityScore(u({followers:23800,following:310,tweets:5200,createdAt:"2016-01-01"}),{views:100000,interactions:4000},now),
 P.qualityScore(u({followers:1000,following:1000,createdAt:new Date(now-30*864e5).toISOString(),tweets:20}),null,now),
 P.qualityScore(u({followers:3000,following:2900}),null,now)];
console.log(JSON.stringify(r.map(x=>[x.score,x.label,x.farm,x.parts.map(p=>p.got)])))'''%EXT
out=json.loads(subprocess.check_output(["node","-e",js]).decode())
check("评分:优质号高分、新号小号低分、互粉号被扣分",out[0][0]>=85 and out[1][0]<=40 and out[2][2] is True and out[2][0]<out[0][0],out)
print("ALL PASS" if ok else "SOME FAIL")
