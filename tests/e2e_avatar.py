"""头像光环测试:默认开、按流速档位、圆/方头像、角标、动画、关闭、减少动态效果。
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
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":800})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    rings="""[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('[data-testid^=UserAvatar-Container-]');const r=c.querySelector(':scope > .fl-ring');const b=c.querySelector(':scope > .fl-ring-badge');return r?{cls:r.className,anim:getComputedStyle(r).animationName,badge:b?b.textContent:null,n:c.querySelectorAll('.fl-ring').length}:null})"""
    check("默认开启:每一档都有光环",all(x is not None for x in pg.evaluate(rings)[:6]))
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:头像光环默认勾选",pop.evaluate("document.querySelector('input[data-key=avatarFx]').checked"))
    pg.bring_to_front(); pg.wait_for_timeout(500)
    s=pg.evaluate(rings); print(json.dumps(s,ensure_ascii=False))
    check("🐢 龟速:灰色细圈(低调,半透明)、🚲 自行车:蓝色细圈,都没有角标",s[0] and "r0" in s[0]["cls"] and s[1] and "r1" in s[1]["cls"] and s[0]["badge"] is None and s[1]["badge"] is None and s[0]["anim"]=="none",[s[0],s[1]])
    check("🛵 小电驴:绿圈 + 呼吸(只用 opacity),无角标",s[2] and "r2" in s[2]["cls"] and "fl-glow-op" in s[2]["anim"] and s[2]["badge"] is None,s[2])
    check("🚀 火箭:彗星尾巴旋转圈;圆形头像没有角标(绕圈的火箭已经是它了)",s[3] and "r3" in s[3]["cls"] and "fl-spin" in s[3]["anim"] and s[3]["badge"] is None,s[3])
    check("⚡ 光速:更快的旋转霓虹圈;圆形头像没有角标",s[4] and "r4" in s[4]["cls"] and "fl-spin" in s[4]["anim"] and s[4]["badge"] is None,s[4])
    # ---- 每一档的"小角色绕着头像跑" ----
    fx=pg.evaluate("""[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('[data-testid^=UserAvatar-Container-]');const w=c.querySelector(':scope > .fl-avx');if(!w)return null;
      const o=w.querySelector('.fl-orbit'),i=w.querySelector('.fl-orbit-i');
      return {cls:w.className,orbit:o?getComputedStyle(o).animationName:null,orbitDur:o?getComputedStyle(o).animationDuration:null,emoji:i?i.textContent:null,iAnim:i?getComputedStyle(i).animationName:null,iDir:i?getComputedStyle(i).animationDirection:null,
        sparks:w.querySelectorAll('.fl-sp').length,ring2:!!w.querySelector('.fl-ring2'),wave:!!w.querySelector('.fl-wave'),waveAnim:w.querySelector('.fl-wave')?getComputedStyle(w.querySelector('.fl-wave')).animationName:null,n:c.querySelectorAll(':scope > .fl-avx').length}})""")
    check("每个头像只有一个特效容器",all(x["n"]==1 for x in fx if x))
    check("🐢 小乌龟 40 秒绕一圈;🚲 8 秒;🛵 4 秒;🚀 2.2 秒;⚡ 1.2 秒(越快跑得越快)",[fx[k]["emoji"] for k in range(5)]==["🐢","🚲","🛵","🚀","⚡"] and [fx[k]["orbitDur"] for k in range(5)]==["40s","8s","4s","2.2s","1.2s"],[(fx[k]["emoji"],fx[k]["orbitDur"]) for k in range(5)])
    check("小角色反向转同样的时间,始终是正的(不会倒着转晕)",all("fl-spin" in fx[k]["iAnim"] and fx[k]["iDir"]=="reverse" for k in range(5)),fx[3])
    check("🚀 有 3 颗 ✨ 星星,⚡ 有 4 个火花;慢档没有",fx[3]["sparks"]==3 and fx[4]["sparks"]==4 and all(fx[k]["sparks"]==0 for k in (0,1,2)),[fx[k]["sparks"] for k in range(5)])
    check("只有 ⚡ 光速有反向内圈和冲击波",fx[4]["ring2"] and fx[4]["wave"] and "fl-wave" in fx[4]["waveAnim"] and not any(fx[k]["ring2"] or fx[k]["wave"] for k in (0,1,2,3)))
    check("方形头像(企业号):没有绕圈小角色和冲击波,不转",fx[5] and fx[5]["emoji"] is None and not fx[5]["wave"],fx[5])
    allanim=pg.evaluate("[...document.querySelectorAll('.fl-ring,.fl-ring2,.fl-orbit,.fl-orbit-i,.fl-sp,.fl-wave')].map(e=>getComputedStyle(e).animationName)")
    check("所有头像动画都只用 transform / opacity(不用 background-position、box-shadow)",all(n in ("none","fl-spin","fl-glow-op","fl-wave","fl-twinkle") for n in allanim),sorted(set(allanim)))
    check("圆形头像用圆环(round)",s[3] and "round" in s[3]["cls"])
    check("还读不到圆角时(图片没加载完):先按圆形画,并标记待补判",s[6] and "round" in s[6]["cls"],s[6])
    # 模拟图片加载完、圆角样式落下来(这个头像其实是方的),再触发一次页面变动 → 应补判成方环
    pg.evaluate("""(()=>{const a=document.querySelectorAll('article')[6];a.querySelector('[data-testid^=UserAvatar-Container-] > div').style.borderRadius='6px';const d=document.createElement('div');d.textContent='x';a.append(d)})()""")
    pg.wait_for_timeout(1200)
    fixed=pg.evaluate("(()=>{const r=document.querySelectorAll('article')[6].querySelector('.fl-ring');return {cls:r.className,shape:r.dataset.flShape}})()")
    check("补判:圆角样式落下来之后,环的形状自动校正成方的",("square" in fixed["cls"]) and fixed["shape"]=="s",fixed)
    check("方形头像用方环,不旋转,有角标 🚀(因为它不绕圈)",s[5] and "square" in s[5]["cls"] and s[5]["anim"]=="none" and s[5]["badge"]=="🚀",s[5])
    check("每个头像只有一个光环(重复渲染不叠加)",all(x["n"]==1 for x in s if x))
    pg.screenshot(path=os.path.join(tempfile.gettempdir(),"shot_avatar.png"))
    pg.emulate_media(reduced_motion="reduce"); pg.wait_for_timeout(300)
    rmv=pg.evaluate("(()=>{const w=document.querySelectorAll('article')[4].querySelector('.fl-avx');return {ring:getComputedStyle(document.querySelectorAll('article')[4].querySelector('.fl-ring')).animationName,orbit:getComputedStyle(w.querySelector('.fl-orbit')).animationName,wave:getComputedStyle(w.querySelector('.fl-wave')).display,spark:getComputedStyle(w.querySelector('.fl-sp')).display}})()")
    check("系统开了减少动态效果:圈、绕圈角色全部静止,星星和冲击波不显示",rmv["ring"]=="none" and rmv["orbit"]=="none" and rmv["wave"]=="none" and rmv["spark"]=="none",rmv)
    pg.emulate_media(reduced_motion="no-preference")
    pop.bring_to_front(); pop.click('input[data-key=avatarFx]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关掉:光环和角标全部消失",pg.evaluate("document.querySelectorAll('.fl-ring,.fl-ring-badge').length")==0)
    pop.bring_to_front(); pop.click('input[data-key=avatarFx]'); pop.wait_for_timeout(300); pop.click('header .sw.big input'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("总开关关闭:光环也清掉",pg.evaluate("document.querySelectorAll('.fl-ring,.fl-ring-badge').length")==0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
