"""头像光环测试(热闹档,完整特效结构;安静/标准档见 e2e_avatar_levels.py):默认开、按流速档位、圆/方头像、角标、动画、关闭、减少动态效果。
运行:python3 tests/e2e_avatar.py"""
import json, tempfile, time, hashlib, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":100,"following":10}}
def tw(i,h,v,age=2): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":user(h)}}}
# 档位(绝对口径,2 小时前发):20→龟速 200→自行车 900→小电驴 5000→火箭 20000→光速;最后一条是方形头像的火箭
cases=[("turtle",20,True),("cyclist",200,True),("scooter",900,True),("rocket",5000,True),("lightspeed",20000,True),("squareco",5000,False),("pending",5000,None)]
data=json.dumps({"data":[tw(i+1,h,v) for i,(h,v,rd) in enumerate(cases)]})
def art(i,h,rd): return f'''<article data-testid="tweet" style="position:relative;width:548px;padding:20px"><div style="display:flex;gap:12px"><div data-testid="UserAvatar-Container-{h}" style="position:relative;width:40px;height:40px;flex:none"><div style="position:absolute;inset:0;overflow:hidden;{'border-radius:9999px;' if rd is True else 'border-radius:6px;' if rd is False else ''}background:#94a3b8"><img style="width:40px;height:40px" alt=""></div></div>
<div style="display:flex;flex-direction:column;width:440px"><div style="display:flex;justify-content:space-between;width:440px"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time>2h</time></a></div></div></div></div><div style="display:flex;width:46px"><button>m</button></div></div>
<div role="group" style="display:flex"><div style="display:flex;width:111px"><a role="link" href="/{h}/status/{i}/analytics">1</a></div></div></div></div></article>'''
HTML=f'<!doctype html><html><body style="margin:20px"><div id=r></div><script>addEventListener("load",function(){{document.getElementById("r").innerHTML={json.dumps("".join(art(i+1,h,rd) for i,(h,v,rd) in enumerate(cases)))};var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()}});</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":800})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    JS="""[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('[data-testid^=UserAvatar-Container-]');const r=c.querySelector(':scope > .fl-ring');if(!r)return null;
     const b=c.querySelector(':scope > .fl-ring-badge'),w=c.querySelector(':scope > .fl-avx'),o=w&&w.querySelector('.fl-orbit'),i=w&&w.querySelector('.fl-orbit-i');
     return {cls:r.className,ringDur:getComputedStyle(r).animationDuration,ringAnim:getComputedStyle(r).animationName,badge:b?b.textContent:null,n:c.querySelectorAll('.fl-ring').length,nfx:c.querySelectorAll(':scope > .fl-avx').length,
      emoji:i?i.textContent:null,orbitDur:o?getComputedStyle(o).animationDuration:null,iAnim:i?getComputedStyle(i).animationName:null,iDir:i?getComputedStyle(i).animationDirection:null,
      parts:w?w.querySelectorAll('*').length:0,shape:r.dataset.flShape}})"""
    s=pg.evaluate(JS); print(json.dumps(s,ensure_ascii=False))
    check("每一档(含慢档)都有速度环",all(x is not None for x in s[:6]))
    check("默认是静态的:环和小图标都不动,每一档(含慢档)都有环",all(x is not None for x in s[:6]) and all(s[k]["ringAnim"]=="none" and s[k]["iAnim"]=="none" for k in range(5)),[(s[k]["ringAnim"],s[k]["iAnim"]) for k in range(5)])
    check("小图标:🐢 🚲 🛵 🚀 ⚡",[s[k]["emoji"] for k in range(5)]==["🐢","🚲","🛵","🚀","⚡"])
    pos=pg.evaluate("[...document.querySelectorAll('article')].slice(0,5).map(a=>{const c=a.querySelector('[data-testid^=UserAvatar-Container-]'),i=c.querySelector('.fl-orbit-i').getBoundingClientRect(),r=c.getBoundingClientRect();return [Math.round(i.left+i.width/2-(r.left+r.width/2)),Math.round(i.top+i.height/2-(r.top+r.height/2)),Math.round(i.width)]})")
    check("静态位置:🐢 🚲 🛵 在右下角,🚀 ⚡ 在右上角(彗星头上),🚀 ⚡ 的图标更大",all(pos[k][0]>0 and pos[k][1]>0 for k in (0,1,2)) and all(pos[k][0]>0 and pos[k][1]<0 for k in (3,4)) and pos[3][2]>pos[0][2],pos)
    check("极简:每个头像只有 1 个环 + 1 个小图标(共 2 个元素),圆形头像没有角标",all(s[k]["n"]==1 and s[k]["nfx"]==1 and s[k]["parts"]==2 and s[k]["badge"] is None for k in range(5)),[s[k]["parts"] for k in range(5)])
    st=pg.evaluate("[...document.querySelectorAll('article')].slice(0,5).map(a=>{const r=a.querySelector('.fl-ring'),b=getComputedStyle(r);return b.backgroundImage.slice(0,40)+'|'+b.paddingTop})")
    check("五档造型不同(环的粗细/颜色各不相同)",len(set(st))==5,st)
    pg.hover('article:nth-child(4) [data-testid^=UserAvatar-Container-]'); pg.wait_for_timeout(120)
    check("鼠标放上去:环脉冲一次(只一次,不循环)",pg.evaluate("(()=>{const r=document.querySelectorAll('article')[3].querySelector('.fl-ring'),s=getComputedStyle(r);return s.animationName==='fl-pulse'&&s.animationIterationCount==='1'})()"))
    pg.mouse.move(2,2); pg.wait_for_timeout(200)
    css=pg.evaluate("[...document.querySelectorAll('.fl-ring,.fl-orbit,.fl-orbit-i')].map(e=>getComputedStyle(e).animationName)")
    check("动画只用 transform(fl-spin)",set(css)<={"fl-spin","none"},sorted(set(css)))
    # 悬停信息卡
    pg.hover('article:nth-child(4) [data-testid^=UserAvatar-Container-]'); pg.wait_for_timeout(300)
    card=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText.replace(/\\n/g,' | '):null})()")
    check("鼠标放到头像上:显示信息卡",card and all(k in card for k in ("次浏览/小时","浏览量","发布","口径")),card)
    pg.mouse.move(2,2); pg.wait_for_timeout(250)
    check("移开后信息卡消失",pg.evaluate("document.getElementById('fl-tip').style.display==='none'"))
    check("方形头像(企业号):不转、没有绕圈小图标,有角标 🚀",s[5] and "square" in s[5]["cls"] and s[5]["ringAnim"]=="none" and s[5]["emoji"] is None and s[5]["badge"]=="🚀",s[5])
    check("还读不到圆角时:先按圆形画并标记待补判",s[6] and "round" in s[6]["cls"] and s[6]["shape"]=="?",s[6])
    pg.evaluate("""(()=>{const a=document.querySelectorAll('article')[6];a.querySelector('[data-testid^=UserAvatar-Container-] > div').style.borderRadius='6px';const d=document.createElement('div');d.textContent='x';a.append(d)})()""")
    pg.wait_for_timeout(1200)
    f=pg.evaluate("(()=>{const c=document.querySelectorAll('article')[6].querySelector('[data-testid^=UserAvatar-Container-]');const r=c.querySelector('.fl-ring');return {cls:r.className,shape:r.dataset.flShape,fx:c.querySelectorAll('.fl-avx').length,n:c.querySelectorAll('.fl-ring').length}})()")
    check("补判:圆角落下来后自动校正成方环,拆掉绕圈图标,不重复叠加","square" in f["cls"] and f["shape"]=="s" and f["fx"]==0 and f["n"]==1,f)
    pg.evaluate("document.querySelectorAll('article').forEach(a=>{const d=document.createElement('div');a.append(d)})"); pg.wait_for_timeout(800)
    check("重复渲染不叠加",all(x["n"]==1 and x["nfx"]<=1 for x in pg.evaluate(JS) if x))
    # ---- 打开"让头像转起来":按流速转,速度 12/6/4/2.4/1.4 秒 ----
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:\"让头像转起来\"默认关闭",pop.evaluate("!document.querySelector('input[data-key=avatarSpin]').checked"))
    pop.click('input[data-key=avatarSpin]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1500)
    sp=pg.evaluate(JS)
    check("转起来:转速跟着流速走 12s / 6s / 4s / 2.4s / 1.4s,小图标同速且反向",[sp[k]["ringDur"] for k in range(5)]==["12s","6s","4s","2.4s","1.4s"] and [sp[k]["orbitDur"] for k in range(5)]==["12s","6s","4s","2.4s","1.4s"] and all(sp[k]["ringAnim"]=="fl-spin" and sp[k]["iDir"]=="reverse" for k in range(5)),[(sp[k]["ringDur"],sp[k]["orbitDur"]) for k in range(5)])
    check("转起来时方形头像仍然不转",sp[5]["ringAnim"]=="none")
    pg.emulate_media(reduced_motion="reduce"); pg.wait_for_timeout(300)
    rm=pg.evaluate("[...document.querySelectorAll('.fl-ring,.fl-orbit,.fl-orbit-i')].every(e=>getComputedStyle(e).animationName==='none')")
    check("系统开了减少动态效果:全部静止",rm)
    pg.emulate_media(reduced_motion="no-preference")
    pop.bring_to_front()
    check("弹窗:头像光环默认勾选;没有强度三档了",pop.evaluate("document.querySelector('input[data-key=avatarFx]').checked") and pop.evaluate("document.querySelectorAll('input[data-key=avatarLevel]').length")==0)
    pop.click('input[data-key=avatarFx]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关掉:环和小图标全部消失",pg.evaluate("document.querySelectorAll('.fl-ring,.fl-avx,.fl-ring-badge').length")==0)
    pop.bring_to_front(); pop.click('input[data-key=avatarFx]'); pop.wait_for_timeout(300); pop.click('header .sw.big input'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("总开关关闭:也清掉",pg.evaluate("document.querySelectorAll('.fl-ring,.fl-avx,.fl-ring-badge').length")==0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
