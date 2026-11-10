"""自查修的几个问题:大头像慢时先用小图兜底再升级、导出 CSV 防公式注入、推文开头去掉链接、Esc 关面板、头像容器用户名匹配。
运行:python3 tests/e2e_audit.py"""
import json, tempfile, time, os, hashlib, base64
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
# 1×1 的橙色 PNG(头像):和灰色首字母底 #475569 能分开
ORANGE=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
def user(h,f,g=100,avatar=None):
    u={"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g},"tweet_counts":{"tweets":500}}
    if avatar: u["avatar"]={"image_url":avatar}
    return u
au=user("author1",5000,100,"https://pbs.twimg.com/profile_images/9/pic_normal.png")
def tw(i,v,age,txt): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":5,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age),"full_text":txt},"core":{"user_results":{"result":au}}}
tweets=[tw(1,9000,30,"=HYPERLINK(\"http://evil\",\"x\") 点我"),tw(2,4000,60,"带链接的推文 https://t.co/AbCdEf 后半句"),tw(3,3000,80,"+cmd 开头"),tw(4,2000,90,"普通推文")]
data=json.dumps({"data":{"user":au,"tweets":tweets}})
ACT='<div style="display:flex;align-items:flex-end;height:48px;margin-left:auto;width:max-content"><button data-testid="userActions" aria-label="更多" style="width:36px;height:36px;margin:0 8px 12px 0">m</button></div>'
# 注意:头像容器的 testid 用大写 Author1,验证按"用户名大小写不敏感"匹配(以前 slice 位置少了一位,永远匹配不上)
PROF='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:20px"><div><div data-testid="UserAvatar-Container-Author1" style="width:80px;height:80px"><img src="https://pbs.twimg.com/profile_images/9/pic_normal.png" style="width:80px;height:80px"></div>'+ACT+'<div data-testid="UserName"><b>author1</b> @author1</div></div><script>addEventListener("load",function(){var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/UserTweets");x.send()})</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":900},accept_downloads=True)
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/author1",lambda r:r.fulfill(status=200,content_type="text/html",body=PROF))
    held=[]
    def pic(r):
        if "_400x400" in r.request.url: held.append(r); return   # 大图先扣着不放(模拟服务器现场缩放很慢),测试里手动放行
        r.fulfill(status=200,content_type="image/png",body=ORANGE,headers={"access-control-allow-origin":"*"})
    ctx.route("https://pbs.twimg.com/**",pic)
    errs=[]; pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/author1"); pg.wait_for_timeout(2500)
    # ---- 头像慢:3.5 秒后先用小图,不是首字母 ----
    pg.click(".fl-card-btn"); t0=time.time()
    pg.wait_for_function("document.querySelector('#fl-card-modal .fl-card-themes button')",timeout=9000); dt=time.time()-t0
    PX="(([x,y])=>{const c=document.querySelector('#fl-card-modal canvas'),g=c.getContext('2d');const d=g.getImageData(2*x,2*y,1,1).data;return [d[0],d[1],d[2]]})"
    px=pg.evaluate(PX,[144,140]); msg=pg.evaluate("document.querySelector('#fl-card-modal .fl-card-msg').textContent")
    check("大头像迟迟不到:约 3.5 秒就用页面上的小图画出名片(不卡 7 秒、不是首字母灰底)",3<dt<6 and px!=[71,85,105] and msg=="",(round(dt,1),px,msg))
    for r in held: r.fulfill(status=200,content_type="image/png",body=ORANGE,headers={"access-control-allow-origin":"*"})   # 大图终于到了
    pg.wait_for_timeout(1500)
    px2=pg.evaluate(PX,[144,140]); check("大图终于到了:自动换上并重画,头像仍然是图片颜色",px2!=[71,85,105],px2)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # ---- 推文复盘:链接去掉、CSV 防公式 ----
    pg.click(".fl-rev-btn"); pg.wait_for_timeout(600)
    txt=pg.evaluate("document.getElementById('fl-fans-modal').innerText")
    check("推文复盘列表里推文开头不带 t.co 链接",("带链接的推文" in txt) and ("t.co" not in txt) and ("AbCdEf" not in txt),txt[txt.index("带链接"):txt.index("带链接")+30] if "带链接" in txt else "")
    with pg.expect_download() as dl: pg.click('.fl-fans-foot button:nth-child(1)')
    lines=open(dl.value.path(),encoding="utf-8-sig").read().strip().split("\n")
    body="\n".join(lines[1:])
    check("导出 CSV:开头是 = 或 + 的推文前面加了单引号,Excel 不会当公式",("'=HYPERLINK" in body) and ("'+cmd" in body) and (",=HYPERLINK" not in body),lines[1][:80])
    for i in range(4):   # 用「关闭」按钮关掉再开几次,最后 Esc 仍能正常关
        pg.click('.fl-fans-foot button:last-child'); pg.wait_for_timeout(100); pg.click(".fl-rev-btn"); pg.wait_for_timeout(200)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("反复打开/用按钮关闭后,Esc 仍然只关一次、不报错",pg.evaluate("!document.getElementById('fl-fans-modal')") and not errs,errs)
    # ---- 名片图标关掉后,推文复盘图标仍然在 ----
    eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    pop.click('input[data-key=cardBtn]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1500)
    st=pg.evaluate("(()=>{const r=document.querySelector('.fl-rev-btn'),a=document.querySelector('[data-testid=userActions]');if(!r)return null;const b=r.getBoundingClientRect(),m=a.getBoundingClientRect();return {noCard:!document.querySelector('.fl-card-btn'),first:r.parentElement.firstElementChild===r,dy:Math.round((b.top+b.height/2)-(m.top+m.height/2))}})()")
    check("关掉「生成名片按钮」:推文复盘图标仍然在那排按钮最左边,并且和旁边按钮同一行",st and st["noCard"] and st["first"] and abs(st["dy"])<=1,st)
    # ---- 弹窗「清除记录」连粉丝/关注列表统计一起清 ----
    pg.evaluate("1")
    pop.bring_to_front()
    pop.evaluate("chrome.storage.local.set({fl_fans:{a:{ts:1,rows:{x:[1,2,3,4]}}},fl_follows:{a:{ts:1,rows:{x:[1,2,3,4,1]}}},fl_hist:{x:[[1,2]]}})")
    pop.reload(); pop.wait_for_timeout(500); pop.click('#clearHist'); pop.wait_for_timeout(400)
    left=pop.evaluate("new Promise(r=>chrome.storage.local.get(['fl_fans','fl_follows','fl_hist'],o=>r(Object.keys(o))))")
    check("弹窗「清除记录」:粉丝构成、关注列表统计和粉丝数历史都被清掉",left==[],left)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
