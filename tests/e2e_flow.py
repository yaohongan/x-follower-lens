"""流速标注测试:档位、口径、位置(头部右侧 / 底部)、窄时只留图标、开关。
运行:python3 tests/e2e_flow.py"""
import json, tempfile, hashlib, time, os
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
now=time.time()
def ago(h): return time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
def user(h,fol): return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":fol,"following":100}}
def tweet(i,u,views,age): return {"__typename":"Tweet","rest_id":str(i),"views":{"count":str(views)},"legacy":{"favorite_count":1,"retweet_count":0,"reply_count":0,"quote_count":0,"created_at":ago(age)},"core":{"user_results":{"result":u}}}
# id, 账号, 粉丝, 浏览量, 发布几小时前, 头部整行宽度, 操作栏"浏览量"格宽度
cases=[(1,"rocketguy",100,5000,2,518,111),(2,"turtleguy",100,20,2,518,111),(3,"oldguy",100,20,30,518,111),
       (4,"bigacct",50000,900,2,518,111),(5,"narrowbar",100,5000,2,518,60),(6,"fresh",100,10,0.2,518,111),
       (7,"squeezedheader",100,5000,2,300,111),(8,"lightspeed",100,20000,2,518,111),(9,"oldfast",100,100000,30,518,111),(10,"ancient",100,100000,800,518,111),(11,"freshfast",100,900,0.05,518,111),(12,"tinyviews",100,5,0.05,518,111),(13,"detailstyle",100,900,2,518,111)]
data=json.dumps({"data":[tweet(i,user(h,f),v,a) for i,h,f,v,a,rw,w in cases]})
# 复刻真实结构:头部整行(space-between) = [名字区 > 列 > User-Name] + [别的插件的小标] + [菜单区];底部操作栏第 4 格放浏览量链接
INLINE_FOREIGN={13}   # 第 13 条:详情页的样子——别人的标 static,嵌在标题行里,旁边还有"订阅"按钮
def art(i,h,rw,w):
    if i in INLINE_FOREIGN:
        return f'''<article data-testid="tweet" style="position:relative;width:548px;display:flex;flex-direction:row"><div style="display:flex;flex-direction:column;flex:1 1 0;min-width:0"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%">
<div style="display:flex;min-width:0"><div style="display:flex;flex-direction:column;min-width:0"><div data-testid="User-Name" style="display:flex;min-width:0;font:15px sans-serif"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time> · 1h</time></a></div></div></div></div>
<div class="hdr-right" style="display:flex;align-items:center;gap:8px"><div class="sopilot-x-velocity-host" style="width:82px;height:20px;background:#a3a;color:#fff;font:12px sans-serif">爆款 28k/h</div><button class="sub-btn" style="width:60px;height:28px">订阅</button><button>g</button><button>m</button></div></div>
<div role="group" style="display:flex"><div style="display:flex;width:111px"><a role="link" href="/{h}/status/{i}/analytics">1</a></div></div></div></article>'''

    overlay_right=96 if i==1 else 5000   # 只有第 1 条有别的插件的浮层(其余放到屏幕外,不参与)
    return f'''<article data-testid="tweet" style="position:relative;width:548px;display:flex;flex-direction:row"><div class="sopilot-x-velocity-host" style="position:absolute;right:{overlay_right}px;top:10px;width:56px;height:20px;z-index:20;background:#1a9;color:#fff;font:12px sans-serif">548/h</div><div style="display:flex;flex-direction:column;flex:1 1 0;min-width:0;max-width:{rw}px"><div style="display:flex;flex-direction:row;justify-content:space-between;width:100%">
<div style="display:flex;min-width:0"><div style="display:flex;flex-direction:column;min-width:0"><div data-testid="User-Name" style="display:flex;min-width:0;font:15px sans-serif"><div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a role="link" href="/{h}">{h} Verified Name Long</a></div><div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px"><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{i}"><time> · 1h</time></a></div></div></div></div>
<span class="xvm-badge" style="display:none"></span><div style="display:flex;width:46px"><button>g</button><button>m</button></div></div>
<div role="group" style="display:flex;justify-content:space-between;width:518px;margin-bottom:14px;font:13px sans-serif"><div style="display:flex;width:111px"><button>1</button></div><div style="display:flex;width:111px"><button>2</button></div><div style="display:flex;width:111px"><button>3</button></div>
<div style="display:flex;width:{w}px;justify-content:flex-start"><a role="link" href="/{h}/status/{i}/analytics">73</a></div><div style="display:flex;width:27px"><button>b</button></div><div style="display:grid;width:19px"><button>s</button></div></div></div></article>'''
HTML=f'<!doctype html><html><body style="margin:30px"><div id=r></div><script>var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/a/HomeTimeline");x.onload=function(){{document.getElementById("r").innerHTML={json.dumps("".join(art(i,h,rw,w) for i,h,f,v,a,rw,w in cases))};}};x.send();</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,
        args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":900,"height":700})
    CUR=[data]
    ctx.add_init_script("""window.__rm={};new MutationObserver(ms=>ms.forEach(m=>m.removedNodes.forEach(n=>{if(n.nodeType!==1)return;const hit=n.classList.contains('fl-flow')?n:(n.querySelector&&n.querySelector('.fl-flow'));if(!hit)return;const a=m.target.closest&&m.target.closest('article');const h=a?((a.querySelector('[data-testid=User-Name] a')||{}).textContent||'?'):'?';window.__rm[h]=(window.__rm[h]||0)+1}))).observe(document,{childList:true,subtree:true});""")
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=CUR[0]))
    ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/home"); pg.wait_for_timeout(2500)
    chips="""[...document.querySelectorAll('article')].map(a=>{const c=a.querySelector('.fl-flow');if(!c)return null;const un=a.querySelector('[data-testid=User-Name]');const row=un.parentElement.parentElement.parentElement;const bar=a.querySelector('[role=group] a[href$="/analytics"]').parentElement;
      return {t:c.textContent.trim(),title:c.title.replace(/\\n/g,' / '),inHeader:c.parentElement===row&&c.nextElementSibling===row.lastElementChild,inBar:c.parentElement===bar,inCorner:c.parentElement===a&&c.classList.contains('fl-flow-c'),barOverflow:bar.scrollWidth>bar.clientWidth+1,cnt:a.querySelectorAll('.fl-flow').length}})"""
    s=pg.evaluate(chips); print(json.dumps(s,ensure_ascii=False)[:600])
    # ---- 默认:角落(盖住别的插件同位置的标)----
    check("默认(角落模式):有别人的标的推文盖在它上面(第 1、13 条);没有的排进标题行(第 4 条)",s[0] and s[0]["inCorner"] and s[12] and s[12]["inCorner"] and s[3] and s[3]["inHeader"] and not s[3]["inCorner"],[(x or {}).get("inCorner") for x in s])
    cv=pg.evaluate("""(()=>{const a=document.querySelector('article');const o=a.querySelector('.sopilot-x-velocity-host');const c=a.querySelector('.fl-flow');
      const or=o.getBoundingClientRect(), cr=c.getBoundingClientRect(), cs=getComputedStyle(c);
      return {covers:cr.left<=or.left+1&&cr.right>=or.right-1&&cr.top<=or.top+1&&cr.bottom>=or.bottom-1, z:+cs.zIndex, ovz:+getComputedStyle(o).zIndex, opaque:(cs.backgroundImage.includes('gradient')||/^rgb\(/.test(cs.backgroundColor))&&!!c.style.getPropertyValue('--fl-bg'), right:cs.right, top:cs.top, ovStillThere:!!o&&o.textContent==='548/h'}})()""")
    check("角落:把别的插件的标完整盖住(位置、尺寸都覆盖)",cv["covers"],cv)
    check("角落:层级比对方高;底色不透明;对方元素原样还在(没删没改)",cv["z"]>cv["ovz"] and cv["opaque"] and cv["ovStillThere"],cv)
    check("没有别的插件的标时:排进标题行(菜单区左边),不占角落坐标、不压 X 自己的按钮",s[3] and s[3]["inHeader"] and not s[3]["inCorner"],s[3])
    # 详情页式:别人的标是 static、嵌在标题行里,旁边有"订阅"按钮
    dv=pg.evaluate("""(()=>{const a=[...document.querySelectorAll('article')].find(x=>x.querySelector('.hdr-right'));const c=a.querySelector('.fl-flow'),f=a.querySelector('.sopilot-x-velocity-host'),s=a.querySelector('.sub-btn');
      const cr=c.getBoundingClientRect(),fr=f.getBoundingClientRect(),sr=s.getBoundingClientRect();
      const hit=(x,y)=>!(x.right<=y.left||x.left>=y.right||x.bottom<=y.top||x.top>=y.bottom);
      return {corner:c.classList.contains('fl-flow-c'),covers:cr.left<=fr.left+1&&cr.right>=fr.right-1&&cr.top<=fr.top+1&&cr.bottom>=fr.bottom-1,hitsSubscribe:hit(cr,sr),foreignThere:!!f&&f.textContent==='爆款 28k/h'}})()""")
    check("详情页式(别人的标嵌在标题行里):按它实际位置完整盖住",dv["corner"] and dv["covers"],dv)
    check("详情页式:没有压到旁边的'订阅'按钮;对方元素原样还在",(not dv["hitsSubscribe"]) and dv["foreignThere"],dv)
    # 别人的标晚到:我们本来排在标题行里,它出现后应自动改成盖住它
    pg.evaluate("""(()=>{const a=document.querySelectorAll('article')[3];const un=a.querySelector('[data-testid=User-Name]');const row=un.parentElement.parentElement.parentElement;const d=document.createElement('div');d.className='sopilot-x-velocity-host late';d.style.cssText='position:absolute;right:96px;top:10px;width:70px;height:20px;background:#a3a;z-index:20';d.textContent='爆款 9k/h';a.append(d)})()"""); pg.wait_for_timeout(900)
    late=pg.evaluate("(()=>{const a=document.querySelectorAll('article')[3];const c=a.querySelector('.fl-flow');const f=a.querySelector('.late');const cr=c.getBoundingClientRect(),fr=f.getBoundingClientRect();return {corner:c.classList.contains('fl-flow-c'),covers:cr.left<=fr.left+1&&cr.right>=fr.right-1&&cr.top<=fr.top+1&&cr.bottom>=fr.bottom-1,n:a.querySelectorAll('.fl-flow').length}})()")
    check("别人的标晚到:自动改成盖住它,而且只有一个流速标",late["corner"] and late["covers"] and late["n"]==1,late)
    pg.evaluate("document.querySelectorAll('article')[3].querySelector('.late').remove()"); pg.wait_for_timeout(900)
    gone=pg.evaluate("(()=>{const a=document.querySelectorAll('article')[3];const c=a.querySelector('.fl-flow');return {corner:c.classList.contains('fl-flow-c'),inHeader:c.classList.contains('fl-flow-h'),n:a.querySelectorAll('.fl-flow').length}})()")
    check("别人的标消失(比如被关掉):自动退回标题行,不再悬空盖在原地",(not gone["corner"]) and gone["inHeader"] and gone["n"]==1,gone)
    # ---- 切到 自动 ----
    # ---- 切到 自动 ----
    pop0=ctx.new_page(); pop0.goto(f"chrome-extension://{eid}/popup.html"); pop0.wait_for_timeout(500)
    check("弹窗:位置默认 角落",pop0.evaluate("document.querySelector('input[data-key=flowPos]:checked').value")=="corner")
    pop0.click('input[data-key=flowFx]'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("关闭流速动效:火箭/光速不再带动效 class",pg.evaluate("document.querySelectorAll('.fl-fx').length")==0)
    pop0.bring_to_front(); pop0.click('input[data-key=flowFx]'); pop0.wait_for_timeout(300)
    pop0.click('input[data-key=flowPos][value=auto] + span'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("自动:头部右侧没被占的推文放头部(菜单区左边)",s[3] and s[3]["inHeader"] and not s[3]["inBar"] and not s[3]["inCorner"])
    check("自动:头部右侧被别的插件浮层占着的推文,改放底部浏览量旁",s[0] and s[0]["inBar"] and not s[0]["inHeader"],(s[0] or {}).get("t"))
    check("5000次/2h=火箭(底部:图标+数字,放不下就只留图标)",s[0] and "🚀" in s[0]["t"],s[0] and s[0]["t"])
    check("20次/2h=龟速",s[1] and "龟速" in s[1]["t"])
    check("发布 30 小时但很慢(龟速):不显示",s[2] is None)
    check("发布 30 小时但很快:显示,并说明是发布以来的平均速度,不带趋势箭头",s[8] and "平均速度" in s[8]["title"] and not any(a in s[8]["t"] for a in "↗↘"),s[8])
    check("发布超过 30 天:不显示",s[9] is None)
    check("900次/2h(粉丝5万,绝对)=小电驴;头部放得下时:名称+数字",s[3] and "小电驴" in s[3]["t"] and "/h" in s[3]["t"],s[3] and s[3]["t"])
    check("刚发布(12 分钟)10 次浏览 = 50/h:显示 🚲 自行车(刚发布也要有)",s[5] and "自行车" in s[5]["t"],s[5] and s[5]["t"])
    check("刚发布(3 分钟)但已经很快:显示,提示里说明数字还不稳",s[10] and "刚发布" in s[10]["title"],s[10])
    check("浏览量不到 10 的:不显示(样本太小)",s[11] is None)
    check("每条推文只有一个流速标",all(x["cnt"]==1 for x in s if x))
    pop0.click('input[data-key=flowPos][value=header] + span'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    ov=pg.evaluate("""(()=>{const a=document.querySelector('article');const o=a.querySelector('.sopilot-x-velocity-host').getBoundingClientRect();
      const chip=a.querySelector('.fl-flow');const c=chip.getBoundingClientRect();const mn=chip.nextElementSibling.getBoundingClientRect();
      return {wouldOverlap:o.left<mn.left-8,overlap:!(c.right<=o.left||c.left>=o.right||c.bottom<=o.top||c.top>=o.bottom),chipRight:Math.round(c.right),ovLeft:Math.round(o.left),menuLeft:Math.round(mn.left)}})()""")
    check("固定放头部时:流速标自动让到浮层左边,不重叠",not ov["overlap"] and ov["chipRight"]<=ov["ovLeft"] and ov["wouldOverlap"],ov)
    check("提示里有每小时浏览量",s[3] and "次浏览/小时" in s[3]["title"])
    check("头部挤的时候逐级缩短(最终只留图标)",s[6] and "火箭" not in s[6]["t"],s[6] and s[6]["t"])
    pg.screenshot(path=os.path.join(tempfile.gettempdir(),"shot_flow_header.png"))
    pop=pop0
    check("弹窗:位置选项含 角落/自动/头部/底部",pop.evaluate("[...document.querySelectorAll('input[data-key=flowPos]')].map(i=>i.value).join()")=="corner,auto,header,bar")
    pop.click('input[data-key=flowPos][value=bar] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("切到底部:全部在浏览量那一格,头部没有",all(x["inBar"] and not x["inHeader"] and x["cnt"]==1 for x in s if x))
    check("底部格子太窄:只留图标",s[4] and s[4]["t"]=="🚀",s[4] and s[4]["t"])
    check("底部格子不溢出",all(not x["barOverflow"] for x in s if x))
    pop.bring_to_front(); pop.click('input[data-key=flowPos][value=header] + span'); pop.click('input[data-key=flowMode][value=rel] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("切回头部 + 相对口径:大号变火箭、小号变光速",s[3] and s[3]["inHeader"] and "火箭" in s[3]["t"] and s[1] and "光速" in s[1]["t"] or (s[3] and "火箭" in s[3]["t"]),(s[3] or {}).get("t"))
    pop.bring_to_front(); pop.click('input[data-key=flow]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("关闭流速:全部消失",pg.evaluate("document.querySelectorAll('.fl-flow').length")==0)
    check("流速关闭不影响粉丝徽标",pg.evaluate("document.querySelectorAll('.fl-badge').length")>0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
