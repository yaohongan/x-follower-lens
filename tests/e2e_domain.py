"""内容方向标签测试:简介判断、靠推文累计判断、自定义词典、悬停卡、开关、清除。
运行:python3 tests/e2e_domain.py"""
import json, tempfile, hashlib, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
def user(h,bio): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2020"},"relationship_counts":{"followers":2000,"following":300},"profile_bio":{"description":bio}}
def tw(i,u,text,rt=False): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":"100"},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"full_text":("RT @someone: " if rt else "")+text,"created_at":"Mon Jan 01 00:00:00 +0000 2020"},"core":{"user_results":{"result":u}}}
coder=user("coder","程序员｜Vibe Coding｜独立开发者"); video=user("videoguy","分享 AI 视频工具实测与横评 影视视效"); blank=user("blanky",""); biz=user("bizguy","独立开发者 AI SAAS 出海进行中")
shop=user("shopper","我做直播带货"); nothing=user("nothing","Retired. 只活一次等于没活。"); rt=user("rtguy","")
tweets=[tw(1,coder,"x"),tw(2,video,"x"),tw(3,biz,"x"),tw(4,shop,"x"),tw(5,nothing,"x")]
# blanky:简介为空,但连发 3 条 Web3 推文 → 靠推文累计判断;rtguy:只有转推,不应被计入
tweets+= [tw(10+i,blank,t) for i,t in enumerate(["今天 BTC 又涨了,链上数据很强","这个 defi 项目空投值得冲","Solana 生态 meme 币"])]
tweets+= [tw(20+i,rt,"RT 里全是 BTC 以太坊 defi 空投",rt=True) for i in range(4)]
data=json.dumps({"data":tweets})
def art(h): return f'<article data-testid="tweet" style="position:relative;width:548px"><div style="display:flex;flex-direction:column;width:548px"><div style="display:flex;justify-content:space-between;width:518px"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a></div></div></div></div><div style="display:flex;width:46px"><button>m</button></div></div></div></article>'
users=["coder","videoguy","blanky","bizguy","shopper","nothing","rtguy"]
HTML=f'<!doctype html><html><body style="margin:30px"><div id=r></div><script>addEventListener("load",function(){{document.getElementById("r").innerHTML={json.dumps("".join(art(h) for h in users))};var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/Home");x.send()}});</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":600})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    dom="""(()=>{const o={};document.querySelectorAll('article').forEach(a=>{const h=a.querySelector('[data-testid=User-Name] a[href]').getAttribute('href').slice(1);const t=a.querySelector('.fl-tag.dom');o[h]=t?t.textContent:null});return o})()"""
    d=pg.evaluate(dom); print(d)
    check("简介:程序员/Vibe Coding → AI编程",d["coder"]=="AI编程")
    check("简介:AI视频工具实测 + 影视视效 → AI视频(不被 AI工具 抢走)",d["videoguy"]=="AI视频")
    check("简介为空但连发 3 条 Web3 推文 → Web3(靠推文累计)",d["blanky"]=="Web3",d["blanky"])
    check("只有转推的账号:转推正文不计入,不贴方向",d["rtguy"] is None,d["rtguy"])
    check("简介没有任何方向线索 → 不乱贴",d["nothing"] is None,d["nothing"])
    check("没有自定义词典时,'直播带货'不贴方向",d["shopper"] is None,d["shopper"])
    pg.hover('article:nth-child(3) .fl-badge'); pg.wait_for_timeout(300)
    tip=pg.evaluate("document.getElementById('fl-tip').innerText")
    check("悬停卡有'内容方向'一行",("内容方向" in tip) and ("Web3" in tip),tip.replace("\n"," | "))
    pg.mouse.move(2,2)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    pop.fill("#customDomains","电商=直播,带货,选品"); pop.wait_for_timeout(900)
    pg.bring_to_front(); pg.wait_for_timeout(1500)
    d=pg.evaluate(dom); print(d)
    check("自定义词典即时生效:'电商' 贴给直播带货的人",d["shopper"]=="电商",d["shopper"])
    pop.bring_to_front(); pop.reload(); pop.wait_for_timeout(500)
    check("自定义词典保存后重开弹窗仍在",pop.input_value("#customDomains")=="电商=直播,带货,选品")
    pop.click('input[data-tag="domain"] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关闭'内容方向'标签:全部不显示",pg.evaluate("document.querySelectorAll('.fl-tag.dom').length")==0)
    pop.bring_to_front(); pop.click('input[data-tag="domain"] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("重新打开:方向标签回来",pg.evaluate("document.querySelectorAll('.fl-tag.dom').length")>=4)
    pg.wait_for_timeout(21500)
    pop.bring_to_front(); pop.reload(); pop.wait_for_timeout(500)
    stored=pop.evaluate("new Promise(r=>chrome.storage.local.get('fl_dom',x=>r(x.fl_dom||null)))")
    check("方向累计真的写进了本地存储(blanky 有 web3 命中;转推账号 rtguy 没有)",stored and "blanky" in stored and stored["blanky"][1].get("web3",0)>=3 and "rtguy" not in stored,stored)
    pop.bring_to_front(); pop.click("#clearHist"); pop.wait_for_timeout(600); pg.bring_to_front(); pg.wait_for_timeout(1200)
    d=pg.evaluate(dom)
    check("清除记录后:靠推文累计的方向没了(blanky),靠简介的还在(coder)",d["blanky"] is None and d["coder"]=="AI编程",d)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
