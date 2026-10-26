"""头像特效强度测试:安静 / 标准两档的结构与"悬停才展开"。
运行:python3 tests/e2e_avatar_levels.py
#默认开、按流速档位、圆/方头像、角标、动画、关闭、减少动态效果。
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
JS="""[...document.querySelectorAll('article')].map(a=>{const w=a.querySelector('[data-testid^=UserAvatar-Container-] > .fl-avx');if(!w)return null;
 const vis=e=>getComputedStyle(e).visibility, q=s=>[...w.querySelectorAll(s)];
 return {cls:w.className,pin:(w.querySelector('.fl-pin')||{}).textContent||null,zzz:!!w.querySelector('.fl-zzz'),puff:!!w.querySelector('.fl-puff'),
  orbits:q('.fl-orbit').length,sparks:q('.fl-sp').length,hot:q('.fl-hot').length,hotVis:q('.fl-hot').map(vis),
  anims:[...w.querySelectorAll('*')].map(e=>getComputedStyle(e).animationName).filter(n=>n!=='none'),
  ringAnim:getComputedStyle(a.querySelector('.fl-ring')).animationName}})"""
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":800})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    errs=[]
    def load(level):
        pre=ctx.new_page(); pre.goto(f"chrome-extension://{eid}/popup.html"); pre.wait_for_timeout(400)
        if level: pre.evaluate("(l)=>new Promise(r=>chrome.storage.local.set({fl_settings:{avatarLevel:l}},r))",level)
        pre.close(); pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.goto("https://x.com/home"); pg.wait_for_timeout(2500); return pg
    # 不设置 → 默认标准档
    pg=load(None); s=pg.evaluate(JS)
    check("默认是标准档",all(x and "lv-standard" in x["cls"] for x in s[:5]),[x and x["cls"] for x in s[:5]])
    check("标准·🐢 💤 飘;🚲 静态 🚲;🛵 静态 🛵 + 💨;都没有绕圈",s[0]["zzz"] and s[1]["pin"]=="🚲" and s[2]["pin"]=="🛵" and s[2]["puff"] and all(s[k]["orbits"]==0 for k in (0,1,2)),[(x["zzz"],x["pin"],x["puff"],x["orbits"]) for x in s[:3]])
    check("标准·🚀 ⚡ 有一个小角色绕圈 + 星星(🚀 1 颗 ⚡ 2 颗)",s[3]["orbits"]>=1 and s[4]["orbits"]>=1 and s[3]["sparks"]>=1 and s[4]["sparks"]>=2,[(x["orbits"],x["sparks"]) for x in s[3:5]])
    check("标准·平时 .fl-hot(残影/光晕/冲击波等)全部隐藏",all(v=="hidden" for k in (3,4) for v in s[k]["hotVis"]) and s[4]["hot"]>0,[s[k]["hotVis"] for k in (3,4)])
    sa=pg.evaluate("[...document.querySelectorAll('.fl-avx.lv-standard .fl-hot')].map(e=>getComputedStyle(e).animationPlayState)")
    check("标准·隐藏的特效同时是暂停的(不耗 GPU)",sa and all(x=="paused" for x in sa),sa[:3])
    pg.hover('article:nth-child(5) [data-testid^=UserAvatar-Container-]'); pg.wait_for_timeout(300)
    h=pg.evaluate("[...document.querySelectorAll('article')[4].querySelectorAll('.fl-avx .fl-hot')].map(e=>[getComputedStyle(e).visibility,getComputedStyle(e).animationPlayState])")
    check("标准·鼠标放到 ⚡ 头像上:隐藏的特效展开并开始播放",h and all(x==["visible","running"] for x in h),h)
    card=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText:null})()")
    check("标准·悬停同时显示信息卡",card and "次浏览/小时" in card,card)
    pg.mouse.move(2,2); pg.wait_for_timeout(250)
    h2=pg.evaluate("[...document.querySelectorAll('article')[4].querySelectorAll('.fl-avx .fl-hot')].map(e=>getComputedStyle(e).visibility)")
    check("标准·移开后重新隐藏",h2 and all(v=="hidden" for v in h2),h2)
    pg.close()
    # 安静档
    pg=load("quiet"); s=pg.evaluate(JS)
    check("安静·只有静态角标(🐢 无角标除外),没有绕圈/星星/任何特效动画",all(x and "lv-quiet" in x["cls"] and x["orbits"]==0 and x["sparks"]==0 and x["hot"]==0 and not x["anims"] for x in s[:5]),[(x or {}).get("anims") for x in s[:5]])
    check("安静·🚲 🛵 🚀 ⚡ 角标 emoji 对应档位",[s[k]["pin"] for k in (1,2,3,4)]==["🚲","🛵","🚀","⚡"],[x["pin"] for x in s[:5]])
    check("安静·圈本身也不动",all(x["ringAnim"]=="none" for x in s[:5]),[x["ringAnim"] for x in s[:5]])
    pg.close()
    # 热闹档保留旧结构:有残影
    pg=load("lively"); s=pg.evaluate(JS)
    check("热闹·🚀 有残影(3 个绕圈)且没有隐藏项",s[3]["orbits"]==3 and s[3]["hot"]==0,s[3])
    pg.close()
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
