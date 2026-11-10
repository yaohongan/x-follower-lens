"""v0.21:关注列表分析(统计条 + 筛选/排序面板)、推文复盘(个人主页小图标 + 面板)、流速标大小。
运行:python3 tests/e2e_v21.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,f,g=100,fb=False,created="Mon Jan 01 00:00:00 +0000 2016"):
    return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":created},"relationship_counts":{"followers":f,"following":g},"relationship_perspectives":{"followed_by":fb,"following":True}}
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)

# ---- 关注列表:共 12 位 ----
recent=time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-20*86400))
fol=[user("m1",500,300,True),user("m2",800,400,True),user("m3",20000,100,True),   # 互关 3
     user("n1",3000,200,False),user("n2",12000,300,False),user("n3",40,20,False),    # 没关注你 3
     user("f1",1500,1500,False),user("f2",1400,1450,True),                          # 疑似互粉 2(f2 互关)
     user("w1",60,50,False,recent),user("w2",90,80,True,recent),                    # 新号 2
     user("b1",90000,10,False),user("b2",15000,500,True)]                           # ≥1万: m3,n2,b1,b2
owner=user("meowner",900,12)
fol_data=json.dumps({"data":{"owner":owner,"list":fol}})
FOL='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div data-testid="primaryColumn"><div id="sticky" style="position:sticky;top:0"><div role="tablist"><div role="tab">关注者</div><div role="tab">正在关注</div></div></div><div>cells</div></div><script>addEventListener("load",function(){var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/Following");x.send()})</script></body></html>'

# ---- 推文复盘:profile 上同一作者 8 条推文(不同时段、不同浏览量)----
def tw(i,u,v,age,inter=10,text=""): 
    return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(v)},"legacy":{"favorite_count":inter,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age),"full_text":text or f"第{i}条推文"},"core":{"user_results":{"result":u}}}
au=user("author1",5000,100)
# 按小时前发布:让它们落在不同时段需要固定本地小时。这里直接用 age(小时)并在断言里只检查"有最佳时段 + 总数",时段由本机时区决定
tweets=[tw(1,au,9000,30,90,"最火的一条"),tw(2,au,4000,60,40),tw(3,au,3000,80,30),tw(4,au,800,100,8),tw(5,au,700,130,7),tw(6,au,600,170,6),tw(7,au,500,200,5),tw(8,au,300,3,3,"刚发的")]
prof_data=json.dumps({"data":{"user":au,"tweets":tweets}})
ACT='<div style="display:flex;align-items:flex-end;height:48px;margin-left:auto;width:max-content"><button data-testid="userActions" aria-label="更多" style="width:36px;height:36px;margin:0 8px 12px 0">m</button></div>'
PROF='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:20px"><div><div data-testid="UserAvatar-Container-author1" style="width:80px;height:80px"><img src="/av.png" style="width:80px;height:80px"></div>'+ACT+'<div data-testid="UserName"><b>author1</b> @author1</div></div><script>addEventListener("load",function(){var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/UserTweets");x.send()})</script></body></html>'

# ---- 流速标大小 ----
def art(i,h): return f'<article data-testid="tweet" style="position:relative;width:560px;padding:12px;box-sizing:border-box"><div style="display:flex;flex-direction:column"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time>2h</time></a></div></div></div></div><div style="display:flex;width:40px"><button>m</button></div></div><div role="group"><div><a href="/{h}/status/{i}/analytics">1</a></div></div></div></article>'
HOME='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps(art(1,"author1"))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.send()})</script></body></html>'

with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":900},accept_downloads=True)
    def api(r):
        u=r.request.url
        body=fol_data if u.endswith("/Following") else prof_data
        r.fulfill(status=200,content_type="application/json",body=body)
    ctx.route("https://x.com/i/api/**",api)
    ctx.route("https://x.com/meowner/following",lambda r:r.fulfill(status=200,content_type="text/html",body=FOL))
    ctx.route("https://x.com/author1",lambda r:r.fulfill(status=200,content_type="text/html",body=PROF))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HOME))
    ctx.route("https://x.com/av.png",lambda r:r.abort())
    errs=[]
    fp=ctx.new_page(); fp.on("pageerror",lambda e:errs.append(str(e)))
    fp.goto("https://x.com/meowner/following"); fp.wait_for_timeout(2500)
    bar=fp.evaluate("(()=>{const b=document.querySelector('.fl-fol-bar');return b?{t:b.innerText.replace(/\\n/g,' | '),after:b.previousElementSibling.id==='sticky'}:null})()")
    check("关注列表页:sticky 头部后面出现「已统计 12 / 12 位关注的人」条",bar and bar["after"] and "已统计 12" in bar["t"] and "/ 12" in bar["t"],bar)
    fp.click('.fol-bar-dummy') if False else fp.click('.fl-fol-bar button:not(.fl-auto-btn)'); fp.wait_for_timeout(500)
    chips=fp.evaluate("[...document.querySelectorAll('.fl-fol-chips button')].map(b=>b.textContent)")
    check("筛选按钮带人数:全部12 / 没关注你 6 / 疑似互粉号 2 / 新号 2 / ≥1万粉 4 / <100粉 3",chips==["全部12","没关注你6","疑似互粉号2","新号(<90 天)2","≥ 1 万粉4","< 100 粉3"],chips)
    rows=lambda: fp.evaluate("[...document.querySelectorAll('.fl-fol-list a')].map(a=>a.querySelector('b').textContent)")
    check("默认「全部」按粉丝数多→少:第一位 @b1(9 万粉)",rows()[0]=="@b1" and len(rows())==12,rows()[:3])
    fp.click('.fl-fol-chips button:nth-child(2)'); fp.wait_for_timeout(200)
    nofb=rows(); check("点「没关注你」:6 位,都带「没关注你」标记",len(nofb)==6 and all(x in ("@n1","@n2","@n3","@f1","@w1","@b1") for x in nofb) and fp.evaluate("[...document.querySelectorAll('.fl-fol-list a em')].every(e=>e.textContent==='没关注你')"),nofb)
    fp.select_option('.fl-fol-sort select','folAsc'); fp.wait_for_timeout(200)
    check("排序改成「粉丝数 少→多」:第一位 @n3(40 粉)",rows()[0]=="@n3",rows())
    fp.click('.fl-fol-chips button:nth-child(3)'); fp.wait_for_timeout(200)
    check("点「疑似互粉号」:@f1 和 @f2",sorted(rows())==["@f1","@f2"],rows())
    with fp.expect_download() as dl: fp.click('.fl-fans-foot button:nth-child(1)')
    path=dl.value.path(); txt=open(path,encoding="utf-8-sig").read()
    check("导出当前筛选 CSV:只含这 2 位 + 表头",txt.strip().split("\n")[0].startswith("handle,") and len(txt.strip().split("\n"))==3 and "f1" in txt and "f2" in txt and "m1" not in txt,txt[:120])
    fp.keyboard.press("Escape"); fp.wait_for_timeout(200)
    check("Esc 关闭",fp.evaluate("!document.getElementById('fl-fans-modal')"))

    # ---- 推文复盘 ----
    pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/author1"); pg.wait_for_timeout(2500)
    btn=pg.evaluate("(()=>{const c=document.querySelector('.fl-card-btn'),r=document.querySelector('.fl-rev-btn');if(!r)return null;const a=r.getBoundingClientRect(),m=document.querySelector('[data-testid=userActions]').getBoundingClientRect();return {afterCard:r.previousElementSibling===c,sz:Math.round(a.width),dy:Math.round((a.top+a.height/2)-(m.top+m.height/2))}})()")
    check("个人主页:名片图标右边多一个「推文复盘」图表图标(36px,和旁边按钮同一行)",btn and btn["afterCard"] and btn["sz"]==36 and abs(btn["dy"])<=1,btn)
    pg.click('.fl-rev-btn'); pg.wait_for_timeout(500)
    rv=pg.evaluate("(()=>{const m=document.getElementById('fl-fans-modal');return m?{t:m.innerText.replace(/\\n/g,' | '),n:m.querySelectorAll('.fl-rev-list a').length,first:(m.querySelector('.fl-rev-list a .t')||{}).textContent,keys:[...m.querySelectorAll('.fl-fans-k b')].map(e=>e.textContent)}:null})()")
    check("复盘面板:已统计 8 条;浏览量最高的第一条是「最火的一条」;列表 8 行",rv and "已统计 8 条" in rv["t"] and rv["first"]=="最火的一条" and rv["n"]==8,rv and rv["t"][:140])
    check("关键数字:最高浏览量 9,000;中位数 750(排序后中间两条 700、800 取平均);互动率 = (90+40+30+8+7+6+5+3)÷(9000+4000+3000+800+700+600+500+300)=1.0%",rv and rv["keys"][2]=="9,000" and rv["keys"][0]=="750" and rv["keys"][1]=="1.00%",rv and rv["keys"])
    with pg.expect_download() as dl: pg.click('.fl-fans-foot button:nth-child(1)')
    t2=open(dl.value.path(),encoding="utf-8-sig").read().strip().split("\n")
    check("导出推文 CSV:表头 + 8 行,按浏览量从高到低",len(t2)==9 and t2[1].split(",")[2]=="9000",t2[:2])
    pg.keyboard.press("Escape")

    # ---- 流速标大小 ----
    hp=ctx.new_page(); hp.on("pageerror",lambda e:errs.append(str(e)))
    hp.goto("https://x.com/home"); hp.wait_for_timeout(2500)
    fs=lambda: hp.evaluate("parseFloat(getComputedStyle(document.querySelector('.fl-flow')).fontSize)")
    f0=fs(); check("流速标默认字号 13px",f0==13,f0)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:流速标大小默认「标准」;新增「关注列表分析条」「推文复盘按钮」两个开关默认开",pop.evaluate("(()=>{const q=k=>document.querySelector('input[data-key='+k+']');return q('flowSize').checked===true&&document.querySelector('input[data-key=flowSize]:checked').value==='m'&&q('followsBar').checked&&q('reviewBtn').checked})()"))
    pop.click('input[data-key=flowSize][value=l] + span'); pop.wait_for_timeout(300); hp.bring_to_front(); hp.wait_for_timeout(1200)
    f1=fs(); pop.bring_to_front(); pop.click('input[data-key=flowSize][value=xl] + span'); pop.wait_for_timeout(300); hp.bring_to_front(); hp.wait_for_timeout(1200); f2=fs()
    check("选「大」:15px;选「特大」:17px",f1==15 and f2==17,(f1,f2))
    pop.bring_to_front(); pop.click('input[data-key=flowSize][value=m] + span'); pop.wait_for_timeout(300)
    # 关闭开关
    pop.click('input[data-key=reviewBtn]'); pop.click('input[data-key=followsBar]'); pop.wait_for_timeout(300)
    pg.bring_to_front(); pg.wait_for_timeout(1200); fp.bring_to_front(); fp.wait_for_timeout(1200)
    check("关掉两个开关:复盘图标和关注分析条都消失",pg.evaluate("!document.querySelector('.fl-rev-btn')") and fp.evaluate("!document.querySelector('.fl-fol-bar')"))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
