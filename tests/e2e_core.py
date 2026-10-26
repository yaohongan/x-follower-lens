"""核心功能回归测试:徽标、标签、自适应布局、悬停卡、淡化、设置面板联动、历史。
运行:python3 tests/e2e_core.py   (需要 playwright 和一个 Chromium/Chrome for Testing)"""
import json, tempfile, hashlib, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
VER=json.load(open(EXT+"/manifest.json"))["version"]
def user(h,fol,fing,created,fby=False,ifo=False): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":created},"relationship_counts":{"followers":fol,"following":fing},"relationship_perspectives":{"followed_by":fby,"following":ifo},"tweet_counts":{"tweets":4321}}
def tweet(i,u,views,likes): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(views)},"legacy":{"favorite_count":likes,"retweet_count":0,"reply_count":0,"quote_count":0},"core":{"user_results":{"result":u}}}
big=user("bigv",520000,300,"Mon Jan 01 00:00:00 +0000 2016",True,True); farm=user("farm",2000,1900,"Mon Jan 01 00:00:00 +0000 2023"); tight=user("tighthandle",1844000,300,"Mon Jan 01 00:00:00 +0000 2016",True,True)
data=json.dumps({"data":[tweet(1,big,100000,6000),tweet(2,tight,100000,200),big,farm]})
def art(h,rowW): return f'<article data-testid="tweet"><div style="display:flex;flex-direction:column;width:{rowW}px"><div style="display:flex;flex-direction:row;width:{rowW}px"><div style="display:flex;flex:1 1 auto;min-width:0"><div style="display:flex;flex-direction:column;min-width:0"><div data-testid="User-Name" style="display:flex;min-width:0;font:15px sans-serif"><div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a role="link" href="/{h}">{h} Verified Name</a></div><div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px"><a role="link" href="/{h}">@{h}</a><span> · 1h</span></div></div></div></div><span style="flex:none;width:70px">544/h</span></div></div></article>'
cell=lambda h:f'<div data-testid="UserCell" role="button"><div><div><a href="/{h}" role="link"><div dir="ltr"><span>{h}</span></div></a></div><div><a href="/{h}" role="link"><div dir="ltr"><span>@{h}</span></div></a></div></div></div>'
HTML=f'<!doctype html><html><body style="margin:30px;font-family:sans-serif"><div id=r></div><div id=c></div><div data-testid="sidebarColumn"><div id=s></div></div><script>var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/Home");x.onload=function(){{document.getElementById("r").innerHTML={json.dumps(art("bigv",700)+art("tighthandle",360))};document.getElementById("c").innerHTML={json.dumps(cell("farm")+cell("bigv"))};document.getElementById("s").innerHTML={json.dumps(cell("farm"))};}};x.send();</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":600})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    st="""[...document.querySelectorAll('article')].map(a=>{const b=a.querySelector('.fl-badge');const un=a.querySelector('[data-testid=User-Name]');return {below:!!b&&!!b.closest('.fl-line'),inline:!!b&&b.parentElement===un,text:b?b.innerText.replace(/\\n/g,' '):null,tags:b?b.querySelectorAll('.fl-tag').length:-1,wrapped:b?[...b.children].some(c=>c.getBoundingClientRect().height>20):null,main:b?b.querySelector('.fl-main').className:''}})"""
    s=pg.evaluate(st); print(s)
    check("徽标:52万 粉丝 + 互关/大V/高互动",s[0]["inline"] and "52万 粉丝" in s[0]["text"] and all(k in s[0]["text"] for k in ("互关","大V","高互动")),s[0]["text"])
    check("粉丝量分级配色(52万=t3)","t3" in s[0]["main"])
    check("窄头部:自动换到下一行且文字不换行",s[1]["below"] and not s[1]["wrapped"])
    cells=pg.evaluate("[...document.querySelectorAll('#c [data-testid=UserCell]')].map(x=>({dim:x.classList.contains('fl-dim'),t:x.innerText.replace(/\\n/g,' ')}))")
    check("互粉号列表项淡化、大V不淡化",cells[0]["dim"] and "疑似互粉号" in cells[0]["t"] and not cells[1]["dim"])
    sb=pg.evaluate("document.querySelector('[data-testid=sidebarColumn] .fl-badge').innerText.replace(/\\n/g,' ')")
    check("右侧窄栏精简(不显示标签)","疑似互粉号" not in sb,sb)
    pg.evaluate("window.__mo=0; document.addEventListener('mouseover',e=>{if(e.target.closest&&e.target.closest('.fl-badge'))window.__mo++})")
    pg.hover('article:first-child .fl-badge'); pg.wait_for_timeout(300)
    tip=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText:null})()")
    check("悬停卡内容",tip and all(k in tip for k in ("520,000","注册","互动率")))
    check("徽标上的 mouseover 不冒泡给页面",pg.evaluate("window.__mo")==0)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗版本号",pop.inner_text("#ver")==f"v{VER}",pop.inner_text("#ver"))
    pop.click('input[data-tag="bigV"] + span'); pop.click('input[data-key=layout][value=below] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(st)
    check("设置即时生效:大V标签消失、布局=单独一行","大V" not in s[0]["text"] and s[0]["below"] and s[1]["below"],s[0]["text"])
    pop.bring_to_front(); pop.click('input[data-key=maxTags][value="0"] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("标签数=0:只剩粉丝数",pg.evaluate(st)[0]["tags"]==0)
    pg.wait_for_timeout(3500); pop.bring_to_front(); pop.reload(); pop.wait_for_timeout(600)
    check("历史记录已写入",int(pop.inner_text("#histCount"))>=3,pop.inner_text("#histCount"))
    pop.click("#clearHist"); pop.wait_for_timeout(400); check("清除记录",pop.inner_text("#histCount")=="0")
    pop.click('header .sw.big input'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("总开关关闭:徽标和单独一行都清除",pg.evaluate("document.querySelectorAll('.fl-badge,.fl-line,.fl-flow').length")==0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
