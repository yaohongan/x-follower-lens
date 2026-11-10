"""粉丝页「自动加载全部」:自己往下滚,让页面把整份列表一页页加载出来;动滚轮就停;限流/到头会停;开关能关。
运行:python3 tests/e2e_auto.py   (约 1 分钟:要真实等页面加载和"停住"的判断)"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Chromium")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
def user(h,f=500,g=100): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g}}
PER=20
def page_users(prefix,pg,n=PER): return [user(f"{prefix}_{pg*PER+i}",100+i*37) for i in range(n)]
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
def html(prefix,pages,path_kind="Followers"):
    # 滚到离底部 300px 内就请求下一页(像 X 的无限滚动);前 PAGES 页之后不再有数据
    return f'''<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div data-testid="primaryColumn"><div style="position:sticky;top:0;background:#fff" id="sticky"><div role="tablist"><div role="tab">关注者</div></div></div><div id="list"></div></div><script>
var page=0,loading=false,PAGES={pages};window.__reqs=0;
function add(p,n){{for(var i=0;i<n;i++){{var d=document.createElement("div");d.setAttribute("data-testid","UserCell");d.style.cssText="height:80px;border-bottom:1px solid #eee";d.textContent="{prefix}_"+(p*{PER}+i);document.getElementById("list").appendChild(d)}}}}
function more(){{if(loading||page>=PAGES)return;loading=true;window.__reqs++;var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/{path_kind}?cursor="+page);x.onload=function(){{try{{var j=JSON.parse(x.responseText);add(page,j.data.list.length)}}catch(e){{}}page++;loading=false}};x.send()}}
addEventListener("load",more);addEventListener("scroll",function(){{if(innerHeight+scrollY>=document.body.scrollHeight-300)more()}});
</script></body></html>'''
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    state={"stall_after":None}
    def api(r):
        u=r.request.url; pg=int(u.split("cursor=")[1]) if "cursor=" in u else 0
        prefix="solo" if "/solo/" in (r.request.headers.get("referer") or "") else ("stall" if "/stall/" in (r.request.headers.get("referer") or "") else ("stop" if "/stop/" in (r.request.headers.get("referer") or "") else "off"))
        n=PER
        if prefix=="stall" and pg>=3: n=0                       # 第 4 页起服务器不再给数据(像被限流)
        owner=user(prefix+"owner",140)
        r.fulfill(status=200,content_type="application/json",body=json.dumps({"data":{"owner":owner,"list":page_users(prefix,pg,n)}}))
    ctx.route("https://x.com/i/api/**",api)
    for name,pages in (("solo",7),("stall",7),("stop",30),("off",7)):
        ctx.route(f"https://x.com/{name}owner/followers",lambda r,name=name,pages=pages:r.fulfill(status=200,content_type="text/html",body=html(name,pages)))
        ctx.route(f"https://x.com/{name}/followers",lambda r:None)
    # 带 referer 里的 /solo/ /stall/ 做不到(同一路径)——改成用不同的账号名:路径 /soloowner/followers 等,referer 即页面地址
    ctx.route("**/*",lambda r:r.fallback())
    errs=[]
    def go(name):
        pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.goto(f"https://x.com/{name}owner/followers"); return pg
    # 因 referer 判断不可靠,直接按页面地址拆数据:重写 api
    def api2(r):
        u=r.request.url; pg=int(u.split("cursor=")[1]) if "cursor=" in u else 0
        ref=(r.request.headers.get("referer") or "")
        name=[n for n in ("solo","stall","stop","off") if f"/{n}owner/" in ref]; name=name[0] if name else "solo"
        n=0 if (name=="stall" and pg>=3) else PER
        owner=user(name+"owner",140 if name!="stop" else 600)
        api2.count[name]=api2.count.get(name,0)+1
        r.fulfill(status=200,content_type="application/json",body=json.dumps({"data":{"owner":owner,"list":page_users(name,pg,n)}}))
    api2.count={}
    ctx.unroute("https://x.com/i/api/**"); ctx.route("https://x.com/i/api/**",api2)
    # ---- 1. 默认开:打开就自动加载到底 ----
    pg=go("solo"); t0=time.time()
    pg.wait_for_function("document.querySelector('.fl-fans-bar')&&/加载完毕/.test(document.querySelector('.fl-fans-bar').innerText)",timeout=60000)
    txt=pg.evaluate("document.querySelector('.fl-fans-bar').innerText.replace(/\\n/g,' ')"); y=pg.evaluate("scrollY")
    check("打开粉丝页:自动往下滚,把 7 页共 140 位粉丝全部加载完,条上写「已统计 140 / 140 … 加载完毕」",("已统计 140 / 140" in txt) and ("加载完毕" in txt),(txt,round(time.time()-t0,1)))
    check("加载完自动滚回顶部",y==0,y)
    check("页面总共只发了 7 次请求(都是页面自己的无限滚动发的,插件不额外发)",api2.count.get("solo")==7,api2.count)
    pg.close()
    # ---- 2. 服务器不再给数据(限流/到头):连续 3 次没新数据就停,不无限滚 ----
    pg=go("stall")
    pg.wait_for_function("document.querySelector('.fl-fans-bar')&&/停住了/.test(document.querySelector('.fl-fans-bar').innerText)",timeout=90000)
    txt=pg.evaluate("document.querySelector('.fl-fans-bar').innerText.replace(/\\n/g,' ')")
    check("第 4 页起没有新数据:停住,提示「停住了…过一会儿再点一次」,已统计 60 位",("已统计 60" in txt) and ("停住了" in txt),txt)
    check("停住后按钮变回「自动加载全部」,可以再点",pg.evaluate("document.querySelector('.fl-auto-btn').textContent")=="自动加载全部")
    pg.close()
    # ---- 3. 你一动滚轮就停 ----
    pg=go("stop")
    pg.wait_for_function("(document.querySelector('.fl-fans-bar')||{innerText:''}).innerText.indexOf('正在加载')>=0",timeout=15000)
    pg.wait_for_timeout(2500); pg.mouse.move(300,300); pg.mouse.wheel(0,-200); pg.wait_for_timeout(1500)
    txt=pg.evaluate("document.querySelector('.fl-fans-bar').innerText.replace(/\\n/g,' ')"); n_after=api2.count.get("stop")
    pg.wait_for_timeout(5000); n_later=api2.count.get("stop")
    check("自动加载中动滚轮:立刻停,提示「已暂停(你操作了页面)」",("已暂停" in txt),txt)
    check("停了就不再加载(之后 5 秒内没有新增请求)",n_later==n_after,(n_after,n_later))
    pg.close()
    # ---- 4. 关掉开关:不自动开始,按钮还在 ----
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:「打开粉丝页自动加载全部」默认开,「打开关注页自动加载全部」默认关",pop.evaluate("document.querySelector('input[data-key=fansAuto]').checked&&!document.querySelector('input[data-key=followsAuto]').checked"))
    pop.click('input[data-key=fansAuto]'); pop.wait_for_timeout(400)
    pg=go("off"); pg.wait_for_timeout(5000)
    txt=pg.evaluate("document.querySelector('.fl-fans-bar').innerText.replace(/\\n/g,' ')")
    check("关掉自动加载:不会自己滚,只统计了第一页 20 位;按钮是「自动加载全部」",("已统计 20" in txt) and pg.evaluate("document.querySelector('.fl-auto-btn').textContent")=="自动加载全部" and api2.count.get("off")==1,(txt,api2.count.get("off")))
    pg.click('.fl-auto-btn'); pg.wait_for_timeout(2500)
    check("手动点「自动加载全部」:开始加载,按钮变成「停止」",pg.evaluate("document.querySelector('.fl-auto-btn').textContent")=="停止" and api2.count.get("off")>1,api2.count.get("off"))
    pg.click('.fl-auto-btn'); pg.wait_for_timeout(3500)
    check("点「停止」:停下,提示「已停止」",pg.evaluate("/已停止/.test(document.querySelector('.fl-fans-bar').innerText)"))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
