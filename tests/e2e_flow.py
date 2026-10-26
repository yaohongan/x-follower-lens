import json, tempfile, hashlib, time, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time()
def ago(h): return time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,fol): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":fol,"following":100}}
def tweet(i,u,views,age): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(views)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":u}}}
cases=[ # id, handle, followers, views, age_h, 单元格宽度
 (1,"rocketguy",100,5000,2,111),(2,"turtleguy",100,20,2,111),(3,"oldguy",100,9999,30,111),
 (4,"bigacct",50000,900,2,111),(5,"narrowguy",100,5000,2,60),(6,"fresh",100,900,0.05,111)]
data=json.dumps({"data":[tweet(i,user(h,f),v,a) for i,h,f,v,a,w in cases]})
def art(i,h,w): return f'''<article data-testid="tweet"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time>1h</time></a></div></div>
<div role="group" style="display:flex;justify-content:space-between;width:518px;margin-bottom:14px;font:13px sans-serif">
<div style="display:flex;width:111px"><button>1</button></div><div style="display:flex;width:111px"><button>2</button></div><div style="display:flex;width:111px"><button>3</button></div>
<div style="display:flex;width:{w}px;justify-content:flex-start"><a role="link" href="/{h}/status/{i}/analytics">73</a></div><div style="display:flex;width:27px"><button>b</button></div><div style="display:grid;width:19px"><button>s</button></div></div></article>'''
HTML=f'<!doctype html><html><body style="margin:30px"><div id=r></div><script>var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/Home");x.onload=function(){{document.getElementById("r").innerHTML={json.dumps("".join(art(i,h,w) for i,h,f,v,a,w in cases))};}};x.send();</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,
        args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":600})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    chips="""[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('.fl-flow');return c?{t:c.textContent,cls:c.className,title:c.title.replace(/\\n/g,' / '),inCell:c.parentElement===a.querySelector('[role=group] a[href$="/analytics"]').parentElement,overflow:c.parentElement.scrollWidth>c.parentElement.clientWidth+1}:null})"""
    s=pg.evaluate(chips); print(json.dumps(s,ensure_ascii=False))
    check("5000次/2h=火箭",s[0] and "火箭" in s[0]["t"],s[0] and s[0]["t"])
    check("20次/2h=龟速",s[1] and "龟速" in s[1]["t"])
    check("发布 30 小时:不显示",s[2] is None)
    check("900次/2h(粉丝5万,绝对口径)=小电驴",s[3] and "小电驴" in s[3]["t"])
    check("格子太窄:只留图标",s[4] and s[4]["t"].strip()=="🚀")
    check("发布不足 15 分钟:不显示",s[5] is None)
    check("放在操作栏浏览量那一格里",all(x["inCell"] for x in s if x))
    check("提示里有每小时浏览量",s[0] and "次浏览/小时" in s[0]["title"],s[0] and s[0]["title"])
    check("格子够宽时没有溢出",not s[0]["overflow"])
    pg.screenshot(path="shot_flow.png")
    # 弹窗:切到相对口径
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:流速默认开启",pop.evaluate("document.querySelector('input[data-key=flow]').checked"))
    check("弹窗:口径默认绝对",pop.evaluate("document.querySelector('input[data-key=flowMode]:checked').value")=="abs")
    pop.click('input[data-key=flowMode][value=rel] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("相对口径:大号 900次/2h 由小电驴变火箭(按粉丝折算)",s[3] and "火箭" in s[3]["t"],s[3] and s[3]["t"])
    check("相对口径:小号 5000次/2h 变光速",s[0] and "光速" in s[0]["t"],s[0] and s[0]["t"])
    check("相对口径提示有说明",s[0] and "按粉丝量折算" in s[0]["title"])
    # 关闭
    pop.bring_to_front(); pop.click('input[data-key=flow]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("关闭流速:全部消失",pg.evaluate("document.querySelectorAll('.fl-flow').length")==0)
    # 总开关与流速互不干扰:流速关了但徽标还在
    check("流速关闭不影响粉丝徽标",pg.evaluate("document.querySelectorAll('.fl-badge').length")>0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
