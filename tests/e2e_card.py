"""账号名片测试:个人主页出现按钮、点开画出名片、下载/复制、非主页没有、关闭开关、评分口径。
运行:python3 tests/e2e_card.py"""
import json, tempfile, time, hashlib, os, base64
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
U={"__typename":"User","rest_id":"9","core":{"screen_name":"coder","name":"代码老张","created_at":"Mon Jan 01 00:00:00 +0000 2016"},"avatar":{"image_url":"https://pbs.twimg.com/profile_images/1/pic_normal.png"},"relationship_counts":{"followers":23800,"following":310},"tweet_counts":{"tweets":5200},"profile_bio":{"description":"独立开发者,用 Cursor 和 Claude Code 写代码,AI编程每日分享"}}
def tw(i): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":"20000"},"legacy":{"favorite_count":900,"retweet_count":100,"reply_count":50,"quote_count":10,"created_at":ago(5),"full_text":"cursor 写代码"},"core":{"user_results":{"result":U}}}
data=json.dumps({"data":{"user":U,"tl":[tw(i) for i in range(1,6)]}})
ACT='''<div style="display:flex;align-items:flex-end;height:48px;margin-left:auto;width:max-content"><button data-testid="userActions" aria-label="更多" style="width:36px;height:36px;margin:0 8px 12px 0">m</button><button data-testid="sendDMFromProfile" style="width:36px;height:36px;margin:0 8px 12px 0">d</button></div>'''
HTML0='''<!doctype html><html><body style="margin:20px;font:15px sans-serif"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='<div><div data-testid="UserAvatar-Container-coder" style="width:80px;height:80px"><img src="/av.png" style="width:80px;height:80px"></div>ACTROW<div data-testid="UserName"><b>代码老张</b> @coder</div><div data-testid="UserDescription">bio</div></div>';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/UserTweets");x.send()});</script></body></html>'''
HTML=HTML0.replace('ACTROW',ACT)
HTML_NOROW=HTML0.replace('ACTROW','')
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":900},accept_downloads=True)
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/av.png",lambda r:r.abort())   # 页面上的头像图拿不到,逼它用接口数据里的头像地址
    reqs=[]
    def pic(r):
        reqs.append(r.request.url); r.fulfill(status=200,content_type="image/png",body=PNG,headers={"access-control-allow-origin":"*"})
    ctx.route("https://pbs.twimg.com/**",pic)
    ctx.route("https://x.com/coder",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    ctx.route("https://x.com/coder/with_replies",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML_NOROW))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML.replace('data-testid="UserName"','data-testid="Other"')))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/coder"); pg.wait_for_timeout(2500)
    check("个人主页:名片入口是一个小图标(36px 圆形,没有文字),放在那排按钮(更多、私信)的最左边",pg.evaluate("(()=>{const b=document.querySelector('.fl-card-btn'),r=b&&b.getBoundingClientRect();return !!b&&b.textContent.trim()===''&&!!b.querySelector('svg')&&Math.round(r.width)===36&&Math.round(r.height)===36&&b.parentElement.firstElementChild===b&&b.nextElementSibling.dataset.testid==='userActions'})()"))
    check("图标不占新的一行:和旁边的按钮同一行(上下居中一致)",pg.evaluate("(()=>{const b=document.querySelector('.fl-card-btn').getBoundingClientRect(),m=document.querySelector('[data-testid=userActions]').getBoundingClientRect();return Math.abs(b.top+b.height/2-(m.top+m.height/2))<=1})()"))
    pg.hover(".fl-card-btn"); pg.wait_for_timeout(250)
    check("鼠标放上去:出现「生成账号名片」提示",pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return !!t&&t.style.display!=='none'&&t.innerText.includes('生成账号名片')})()"))
    pg.mouse.move(2,2)
    pg.click(".fl-card-btn"); pg.wait_for_timeout(1200)
    check("点开:出现弹层和画布",pg.evaluate("!!document.querySelector('#fl-card-modal canvas')"))
    info=pg.evaluate("(()=>{const c=document.querySelector('#fl-card-modal canvas');const g=c.getContext('2d');const d=g.getImageData(0,0,c.width,c.height).data;let nz=0;for(let i=0;i<d.length;i+=4*500)if(d[i]+d[i+1]+d[i+2]>60)nz++;return {w:c.width,h:c.height,nz,url:c.toDataURL('image/png')}})()")
    check("画布尺寸 1600×2360,且画了内容(不是空白)",info["w"]==1600 and info["h"]==2360 and info["nz"]>50,(info["w"],info["h"],info["nz"]))
    open(os.path.join(tempfile.gettempdir(),"shot_card.png"),"wb").write(base64.b64decode(info["url"].split(",")[1]))
    check("头像:用接口数据里的头像地址(并换成 400x400 大图),不是首字母",any(u.endswith("pic_400x400.png") for u in reqs),reqs)
    PXJS="(([x,y])=>{const c=document.querySelector('#fl-card-modal canvas'),g=c.getContext('2d');const d=g.getImageData(2*x,2*y,1,1).data;return [d[0],d[1],d[2]]})"
    BG={"wrapped":[198,255,58],"gold":[16,15,14]}
    pxw=pg.evaluate(PXJS,[666,128])
    check("年度风格:头像位置画的是头像本身的颜色(不是首字母灰底 #475569,也不是背景色)",pxw!=[71,85,105] and sum(abs(a-b) for a,b in zip(pxw,BG["wrapped"]))>40,pxw)
    pg.click(".fl-card-themes button[data-t=gold]"); pg.wait_for_timeout(300)
    pxg=pg.evaluate(PXJS,[156,270])
    check("黑金风格:头像位置同样是头像本身的颜色",pxg!=[71,85,105] and sum(pxg)>60,pxg)
    check("风格按钮只有「年度」「黑金」两个,切换后记住",pg.evaluate("[...document.querySelectorAll('.fl-card-themes button')].map(b=>b.textContent).join()")=="年度,黑金" and pg.evaluate("localStorage.getItem('fl_card_theme')")=="gold")
    pg.click(".fl-card-themes button[data-t=wrapped]"); pg.wait_for_timeout(200)

    with pg.expect_download() as dl: pg.click('#fl-card-modal [data-a=dl]')
    check("下载图片:文件名带账号名",dl.value.suggested_filename=="粉丝透镜-coder.png",dl.value.suggested_filename)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("按 Esc 关闭弹层",pg.evaluate("!document.querySelector('#fl-card-modal')"))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2000)
    pg2=ctx.new_page(); pg2.goto("https://x.com/coder/with_replies"); pg2.wait_for_timeout(2500)
    check("找不到那排按钮(X 改版)时:退回放在用户名块后面,仍然只是个小图标",pg2.evaluate("(()=>{const b=document.querySelector('.fl-card-btn');return !!b&&b.textContent.trim()===''&&b.previousElementSibling.dataset.testid==='UserName'&&b.getBoundingClientRect().width<=32})()"))
    pg2.close()
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
