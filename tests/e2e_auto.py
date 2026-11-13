"""粉丝页「自动加载全部」(遮罩锁定 + 限流管家 + 增量更新 + 认证粉丝 + 主页一键图标)。
模拟 X 的无限滚动:滚到离底部 300px 内就请求下一页,响应头带 x-rate-limit-*。
运行:python3 tests/e2e_auto.py   (约 2 分钟:要真实等页面一页页加载)"""
import json, tempfile, time, os, hashlib, re
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Chromium")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
PER=20
def user(h,f=500,g=100): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g}}
def fol(i): return 100+i*37          # 第 i 位粉丝的粉丝数(可重复计算)
def users_of(prefix,idx): return [user(f"{prefix}_{i}",fol(i)) for i in idx]
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
LIST_CSS="height:80px;border-bottom:1px solid #eee"
def followers_dom(prefix,op,pages):
    return f'''<div data-testid="primaryColumn"><div style="position:sticky;top:0;background:#fff"><div role="tablist"><div role="tab">关注者</div></div></div><div id="list"></div></div>'''
def scripts(prefix,op,pages):
    return f'''var page=0,loading=false,PAGES={pages},LIST=document.getElementById("list");window.__reqs=0;
function add(p,names){{names.forEach(function(nm){{var d=document.createElement("div");d.setAttribute("data-testid","UserCell");d.style.cssText="{LIST_CSS}";d.textContent=nm;LIST.appendChild(d)}})}}
function more(){{if(loading||page>=PAGES)return;loading=true;window.__reqs++;var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/{op}?cursor="+page);x.onload=function(){{try{{var j=JSON.parse(x.responseText);add(page,j.data.list.map(function(u){{return u.core.screen_name}}))}}catch(e){{}}page++;loading=false}};x.send()}}
addEventListener("load",more);addEventListener("scroll",function(){{if(innerHeight+scrollY>=document.body.scrollHeight-300)more()}});'''
def html(prefix,op,pages): return f'<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">{followers_dom(prefix,op,pages)}<script>{scripts(prefix,op,pages)}</script></body></html>'

with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    count={}
    def page_for(name,pg):
        """每个场景的服务器行为:返回 (用户列表, 剩余额度)"""
        if name=="solo": return users_of("solo",range(pg*PER,pg*PER+PER)),50-pg-1
        if name=="rate": return users_of("rate",range(pg*PER,pg*PER+PER)),4-pg          # 第 4 页后剩余 1 → 该停
        if name=="stop": return users_of("stop",range(pg*PER,pg*PER+PER)),50-pg-1
        if name=="inc":  return users_of("inc",range(pg*PER,pg*PER+PER)),49             # 和已存的完全一样
        if name=="inc2": return (users_of("new",range(5))+users_of("inc",range(0,15))) if pg==0 else users_of("inc",range(15+(pg-1)*PER,15+pg*PER)),49
        if name=="verif": return (users_of("ver",range(pg*PER,pg*PER+PER)) if pg<2 else users_of("ver",range(40,42))),49-pg
        if name=="one":  return users_of("one",range(pg*PER,pg*PER+PER)),49-pg
        if name=="off":  return users_of("off",range(pg*PER,pg*PER+PER)),49-pg
        return [],49
    def api(r):
        u=r.request.url; pg=int(u.split("cursor=")[1].split("&")[0]) if "cursor=" in u else 0
        ref=(r.request.headers.get("referer") or ""); name=next((n for n in ("solo","rate","stop","inc","inc2","verif","one","off") if re.search(f"/{n}owner(/|$|\\?)",ref)),"solo")
        us,rem=page_for(name,pg); count[name]=count.get(name,0)+1
        total={"solo":140,"rate":600,"stop":600,"inc":140,"inc2":145,"verif":0,"one":100,"off":140}[name]
        r.fulfill(status=200,content_type="application/json",headers={"x-rate-limit-limit":"50","x-rate-limit-remaining":str(max(rem,0)),"x-rate-limit-reset":str(int(time.time())+900)},body=json.dumps({"data":{"owner":user(name+"owner",total),"list":us}}))
    ctx.route("https://x.com/i/api/**",api)
    for name,op,pages,path in (("solo","Followers",7,"followers"),("rate","Followers",30,"followers"),("stop","Followers",30,"followers"),("inc","Followers",7,"followers"),("inc2","Followers",8,"followers"),("verif","BlueVerifiedFollowers",3,"verified_followers"),("off","Followers",7,"followers")):
        ctx.route(f"https://x.com/{name}owner/{path}",lambda r,name=name,op=op,pages=pages:r.fulfill(status=200,content_type="text/html",body=html(name,op,pages)))
    # 一键图标:主页和粉丝页在同一个页面里,点链接用 pushState 切换(像 X 的单页应用)
    ONE=f'''<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="prof"><div data-testid="UserAvatar-Container-oneowner" style="width:80px;height:80px"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div style="display:flex;align-items:flex-end;height:48px;margin-left:auto;width:max-content"><button data-testid="userActions" aria-label="更多" style="width:36px;height:36px;margin:0 8px 12px 0">m</button></div><div data-testid="UserName"><b>oneowner</b> @oneowner</div><a id="lnk" href="/oneowner/followers">关注者</a></div><div id="fl" style="display:none">{followers_dom("one","Followers",5)}</div><script>
var LISTSRC={json.dumps(scripts("one","Followers",5))};
document.getElementById("lnk").addEventListener("click",function(e){{e.preventDefault();history.pushState({{}},"","/oneowner/followers");document.getElementById("prof").style.display="none";var f=document.getElementById("fl");f.style.display="block";window.eval(LISTSRC.replace('LIST=document.getElementById("list")','LIST=document.getElementById("list")'));more()}});
addEventListener("load",function(){{var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/UserByScreenName");x.send()}});
</script></body></html>'''
    ctx.route("https://x.com/oneowner",lambda r:r.fulfill(status=200,content_type="text/html",body=ONE))
    errs=[]
    def go(path):
        pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e))); pg.goto("https://x.com/"+path); return pg
    BAR="document.querySelector('.fl-fans-bar')?document.querySelector('.fl-fans-bar').innerText.replace(/\\n/g,' '):''"
    # ---- 1. 默认开:遮罩锁定,滚轮不会打断,加载到底;加载完遮罩消失、回到顶部 ----
    pg=go("soloowner/followers"); t0=time.time()
    pg.wait_for_function("document.getElementById('fl-auto-overlay')",timeout=15000)
    ov=pg.evaluate("document.getElementById('fl-auto-overlay').innerText.replace(/\\n/g,' ')")
    pg.mouse.move(300,300); pg.mouse.wheel(0,-300); pg.mouse.wheel(0,300); pg.keyboard.press("PageUp")   # 你乱动:遮罩吞掉,不打断
    pg.wait_for_function("/加载完毕/.test("+BAR+")",timeout=60000)
    txt=pg.evaluate(BAR); y=pg.evaluate("scrollY")
    check("加载中整页有遮罩:写「正在分析粉丝…已统计 N / 140」和额度用了几次,并说明页面已锁定",("正在分析粉丝" in ov) and ("/ 140" in ov) and ("额度已用" in ov) and ("已锁定" in ov),ov)
    check("加载中乱动滚轮/翻页键不会打断:140 位全部加载完,条上写「加载完毕」",("已统计 140 / 140" in txt) and ("加载完毕" in txt),(txt,round(time.time()-t0,1)))
    check("加载完:遮罩消失、回到顶部、按钮变成「检查新增」",pg.evaluate("!document.getElementById('fl-auto-overlay')") and y==0 and pg.evaluate("document.querySelector('.fl-auto-btn').textContent")=="检查新增",y)
    check("请求总数 = 页面自己的无限滚动发的 7 次,插件不额外发",count.get("solo")==7,count)
    pg.close()
    # ---- 2. 限流管家:剩余额度只剩 1 次就停,不把额度烧光 ----
    pg=go("rateowner/followers")
    pg.wait_for_function("/用满本时段额度/.test("+BAR+")",timeout=60000)
    txt=pg.evaluate(BAR)
    check("额度只剩 1 次:停住并提示「已用满本时段额度,约 15 分钟后恢复」,不再发请求",("已用满本时段额度" in txt) and ("15 分钟" in txt) and count.get("rate")==4,(txt,count.get("rate")))
    pg.close()
    # ---- 3. 取消:遮罩上的按钮 / Esc ----
    pg=go("stopowner/followers")
    pg.wait_for_function("document.getElementById('fl-auto-overlay')",timeout=15000); pg.wait_for_timeout(1500)
    pg.click("#fl-auto-overlay button"); pg.wait_for_timeout(2500); n1=count.get("stop"); pg.wait_for_timeout(4000); n2=count.get("stop")
    txt=pg.evaluate(BAR)
    check("点遮罩上的「取消」:停下,提示「已取消」,遮罩消失,之后不再有请求",("已取消" in txt) and pg.evaluate("!document.getElementById('fl-auto-overlay')") and n1==n2,(txt,n1,n2))
    pg.close()
    # ---- 4. 增量:统计完整过之后,再打开只补新增 ----
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(500)
    seed=lambda owner,prefix,n:{owner:{"ts":1,"full":1,"rows":{f"{prefix}_{i}":[fol(i),100,0,1,0] for i in range(n)}}}
    pop.evaluate("(s)=>chrome.storage.local.set({fl_fans:s})",{**seed("incowner","inc",140),**seed("inc2owner","inc",140)})
    pop.wait_for_timeout(300)
    pg=go("incowner/followers"); pg.wait_for_timeout(5000)
    txt=pg.evaluate(BAR)
    check("统计已完整、第一页全是老面孔:不滚动,提示「已是最新,没有新增」,总共只有 1 次请求",("已是最新" in txt) and count.get("inc")==1,(txt,count.get("inc")))
    pg.close()
    pg=go("inc2owner/followers")
    try: pg.wait_for_function("/已更新/.test("+BAR+")",timeout=40000)
    except Exception: print("DEBUG inc2:",pg.evaluate(BAR),count)
    txt=pg.evaluate(BAR)
    check("第一页有 5 位新粉丝:继续滚到老面孔为止,提示「已更新,新增 5 位」,只发了 2 次请求(不是把 145 位重新加载一遍)",("新增 5 位" in txt) and ("已统计 145" in txt) and count.get("inc2")==2,(txt,count.get("inc2")))
    pg.close()
    # ---- 5. 认证关注者:很小,自动加载完整 ----
    pg=go("verifowner/verified_followers")
    pg.wait_for_function("/加载完毕/.test("+BAR+")",timeout=60000)
    txt=pg.evaluate(BAR)
    check("认证关注者页:统计「认证粉丝」42 位(最后一页只有 2 位 = 到头),不依赖总数",("已统计认证粉丝 42 位" in txt) and ("加载完毕" in txt),txt)
    pg.click(".fl-fans-bar button:not(.fl-auto-btn)"); pg.wait_for_timeout(500)
    panel=pg.evaluate("document.getElementById('fl-fans-modal').innerText.replace(/\\n/g,' | ')")
    check("面板里单独写出「认证粉丝 42 位 · ≥3000 / ≥1 万 / ≥3 万 各多少」",("认证粉丝 42 位" in panel) and ("≥ 1 万" in panel),panel[:200])
    pg.keyboard.press("Escape"); pg.close()
    # ---- 6. 主页上的一键图标:点一下跳到粉丝页、自动加载、完成后弹面板 ----
    pg=go("oneowner"); pg.wait_for_timeout(2500)
    ic=pg.evaluate("(()=>{const b=document.querySelector('.fl-fansbtn'),m=document.querySelector('[data-testid=userActions]');if(!b)return null;const r=b.getBoundingClientRect(),q=m.getBoundingClientRect();return {w:Math.round(r.width),dy:Math.round((r.top+r.height/2)-(q.top+q.height/2))}})()")
    check("主页上出现第三个小图标「粉丝构成」(36px,和旁边按钮同一行)",ic and ic["w"]==36 and abs(ic["dy"])<=1,ic)
    pg.click(".fl-fansbtn")
    pg.wait_for_function("document.getElementById('fl-fans-modal')",timeout=60000)
    panel=pg.evaluate("document.getElementById('fl-fans-modal').innerText.replace(/\\n/g,' | ')")
    check("点图标:自动跳到粉丝页、加载完、直接弹出粉丝构成面板(已统计 100 / 100)",("粉丝构成" in panel) and ("已统计 100 / 100" in panel),panel[:120])
    pg.keyboard.press("Escape"); pg.close()
    # ---- 7. 关掉开关:不自己滚;「重新完整分析」等 ----
    pop.bring_to_front(); pop.reload(); pop.wait_for_timeout(500)
    check("弹窗:自动加载默认开、主页图标默认开",pop.evaluate("document.querySelector('input[data-key=fansAuto]').checked&&document.querySelector('input[data-key=fansBtn]').checked"))
    pop.click('input[data-key=fansAuto]'); pop.wait_for_timeout(400)
    pg=go("offowner/followers"); pg.wait_for_timeout(4500)
    txt=pg.evaluate(BAR)
    check("关掉自动加载:不会自己滚,只有第一页 20 位,按钮是「自动加载全部」,没有遮罩",("已统计 20" in txt) and pg.evaluate("document.querySelector('.fl-auto-btn').textContent")=="自动加载全部" and pg.evaluate("!document.getElementById('fl-auto-overlay')") and count.get("off")==1,(txt,count.get("off")))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
