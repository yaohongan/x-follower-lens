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
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,
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
    # ---- 默认:替换(隐藏别的插件的流速标,我们的排进标题行)----
    check("默认(替换):流速标排进标题行(菜单区左边),没有悬空的绝对定位;名字特别长放不下的(第 7 条)改放底部、绝不遮挡文字",all(x is None or (not x["inCorner"]) for x in s) and s[0]["inHeader"] and s[12]["inHeader"] and s[6] and s[6]["inBar"],[(x or {}).get("inHeader") for x in s])
    rp=pg.evaluate("""(()=>{const f=(i)=>{const a=document.querySelectorAll('article')[i];const fo=a.querySelector('.sopilot-x-velocity-host');return fo?getComputedStyle(fo).visibility:null};
      const hit=(x,y)=>!(x.right<=y.left||x.left>=y.right||x.bottom<=y.top||x.top>=y.bottom);
      const a=[...document.querySelectorAll('article')].find(x=>x.querySelector('.hdr-right'));const c=a.querySelector('.fl-flow').getBoundingClientRect(),s=a.querySelector('.sub-btn').getBoundingClientRect();
      const names=[...document.querySelectorAll('article')[0].querySelectorAll('[data-testid=User-Name] a, [data-testid=User-Name] time')];const c0=document.querySelectorAll('article')[0].querySelector('.fl-flow').getBoundingClientRect();
      return {vis0:f(0),vis12:f(12),stillThere0:!!document.querySelectorAll('article')[0].querySelector('.sopilot-x-velocity-host'),hitSub:hit(c,s),hitText:names.some(n=>{const r=n.getBoundingClientRect();return r.width>0&&hit(c0,r)}),htmlCls:document.documentElement.classList.contains('fl-hide-foreign')}})()""")
    check("别的插件的流速标被隐藏(visibility:hidden),但元素还在(没删没改):时间线式和详情页式都是",rp["vis0"]=="hidden" and rp["vis12"]=="hidden" and rp["stillThere0"] and rp["htmlCls"],rp)
    check("我们的标不遮挡名字/时间,也不压旁边的'订阅'按钮(详情页式)",(not rp["hitText"]) and (not rp["hitSub"]),rp)
    # 别人的标晚到:也要被隐藏
    pg.evaluate("""(()=>{const a=document.querySelectorAll('article')[3];const d=document.createElement('div');d.className='sopilot-x-velocity-host late';d.style.cssText='position:absolute;right:96px;top:10px;width:70px;height:20px;background:#a3a;z-index:20';d.textContent='爆款 9k/h';a.append(d)})()"""); pg.wait_for_timeout(600)
    late=pg.evaluate("(()=>{const a=document.querySelectorAll('article')[3];return {vis:getComputedStyle(a.querySelector('.late')).visibility,n:a.querySelectorAll('.fl-flow').length,inHeader:a.querySelector('.fl-flow').classList.contains('fl-flow-h')}})()")
    check("别人的标晚到:同样被隐藏;我们仍只有一个流速标,位置不动",late["vis"]=="hidden" and late["n"]==1 and late["inHeader"],late)
    pg.evaluate("document.querySelector('.late').remove()")   # 清理这个假的"别人的标",免得影响后面"自动/头部"模式的测试
    # 悬停信息卡(第 4 条 = 小电驴 450/h)
    pg.hover('article:nth-child(4) .fl-flow'); pg.wait_for_timeout(250)
    card=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText.replace(/\\n/g,' | '):null})()")
    check("鼠标放到流速标上:立刻显示信息卡(破圈倍数、累计被看、已发出、平均每小时被看、圈子刻度)",card and all(k in card for k in ("平均每小时被看","累计被看","已发出","破圈倍数","圈子刻度")),card)
    pg.mouse.move(2,2); pg.wait_for_timeout(200)
    check("移开后信息卡消失",pg.evaluate("document.getElementById('fl-tip').style.display==='none'"))
    # ---- 切到 自动 ----
    pop0=ctx.new_page(); pop0.goto(f"chrome-extension://{eid}/popup.html"); pop0.wait_for_timeout(500)
    check("弹窗:位置默认 替换(corner)",pop0.evaluate("document.querySelector('input[data-key=flowPos]:checked').value")=="corner")
    pop0.click('input[data-key=flowFx]'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("关闭流速动效:火箭/光速不再带动效 class",pg.evaluate("document.querySelectorAll('.fl-fx').length")==0)
    pop0.bring_to_front(); pop0.click('input[data-key=flowFx]'); pop0.wait_for_timeout(300)
    # 默认已把别人的标隐藏,就无所谓"被占着"了。要测"自动"和"头部"的避让,先把"隐藏别的插件的流速标"关掉
    check("弹窗:'隐藏别的插件的流速标'默认勾选",pop0.evaluate("document.querySelector('input[data-key=hideForeign]').checked"))
    pop0.click('input[data-key=hideForeign]'); pop0.wait_for_timeout(300)
    pop0.click('input[data-key=flowPos][value=auto] + span'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关掉隐藏后:别的插件的标重新可见(没有被我们永久改掉)",pg.evaluate("getComputedStyle(document.querySelectorAll('article')[0].querySelector('.sopilot-x-velocity-host')).visibility")=="visible")
    s=pg.evaluate(chips)
    check("自动:头部右侧没被占的推文放头部(菜单区左边)",s[3] and s[3]["inHeader"] and not s[3]["inBar"] and not s[3]["inCorner"])
    check("自动:头部右侧被别的插件浮层占着的推文,改放底部浏览量旁",s[0] and s[0]["inBar"] and not s[0]["inHeader"],(s[0] or {}).get("t"))
    check("5000 浏览/100 粉丝=50×全网(底部:图标+数字,放不下就只留图标)",s[0] and "🌍" in s[0]["t"],s[0] and s[0]["t"])
    check("20 浏览/100 粉丝=0.2×:只写倍数「🫧 0.2×」(0.1–0.3× 不写档名)",s[1] and s[1]["t"]=="🫧 0.2×",s[1] and s[1]["t"])
    check("发布 30 小时、没出圈:也显示 🫧 0.2×(不藏低档)",s[2] and s[2]["t"]=="🫧 0.2×",s[2] and s[2]["t"])
    pg.hover('article:nth-child(9) .fl-flow'); pg.wait_for_timeout(250)
    c9=pg.evaluate("document.getElementById('fl-tip').innerText"); pg.mouse.move(2,2)
    check("发布 30 小时但倍数很高:显示,信息卡说明是整段时间的累计,不带趋势箭头",s[8] and "整段时间" in c9 and not any(a in s[8]["t"] for a in "↗↘"),c9.replace(chr(10)," | "))
    check("发布超过 30 天:不显示",s[9] is None)
    check("900 浏览/5 万粉丝=0.018×:只留图标 🫧(<0.1× 不吵)",s[3] and s[3]["t"]=="🫧",s[3] and s[3]["t"])
    check("刚发布(12 分钟)10 次浏览/100 粉丝=0.1×:显示 🫧 0.1×(刚发布也要有)",s[5] and s[5]["t"]=="🫧 0.1×",s[5] and s[5]["t"])
    pg.hover('article:nth-child(11) .fl-flow'); pg.wait_for_timeout(250)
    c11=pg.evaluate("document.getElementById('fl-tip').innerText"); pg.mouse.move(2,2)
    check("刚发布(3 分钟)但已经很快:显示,信息卡说明数字还不稳",s[10] and "刚发出来" in c11,c11.replace(chr(10)," | "))
    check("浏览量很少的(5 次/3 分钟)也显示图标,不再设样本门槛",s[11] and s[11]["t"]=="🫧",s[11] and s[11]["t"])
    check("每条推文只有一个流速标",all(x["cnt"]==1 for x in s if x))
    pop0.click('input[data-key=flowPos][value=header] + span'); pop0.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    ov=pg.evaluate("""(()=>{const a=document.querySelector('article');const o=a.querySelector('.sopilot-x-velocity-host').getBoundingClientRect();
      const chip=a.querySelector('.fl-flow');const c=chip.getBoundingClientRect();const mn=chip.nextElementSibling.getBoundingClientRect();
      return {wouldOverlap:o.left<mn.left-8,overlap:!(c.right<=o.left||c.left>=o.right||c.bottom<=o.top||c.top>=o.bottom),chipRight:Math.round(c.right),ovLeft:Math.round(o.left),menuLeft:Math.round(mn.left)}})()""")
    check("固定放头部时:流速标自动让到浮层左边,不重叠",not ov["overlap"] and ov["chipRight"]<=ov["ovLeft"] and ov["wouldOverlap"],ov)
    check("流速标还在",s[3] is not None)
    check("头部挤的时候逐级缩短(最终只留图标)",s[6] and "全网" not in s[6]["t"],s[6] and s[6]["t"])
    pg.screenshot(path=os.path.join(tempfile.gettempdir(),"shot_flow_header.png"))
    pop=pop0
    check("弹窗:位置选项含 角落/自动/头部/底部",pop.evaluate("[...document.querySelectorAll('input[data-key=flowPos]')].map(i=>i.value).join()")=="corner,auto,header,bar")
    pop.click('input[data-key=flowPos][value=bar] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("切到底部:全部在浏览量那一格,头部没有",all(x["inBar"] and not x["inHeader"] and x["cnt"]==1 for x in s if x))
    check("底部格子太窄:只留图标",s[4] and s[4]["t"]=="🌍",s[4] and s[4]["t"])
    check("底部格子不溢出",all(not x["barOverflow"] for x in s if x))
    pop.bring_to_front(); pop.click('input[data-key=flowPos][value=header] + span'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=pg.evaluate(chips)
    check("切回头部:标回到标题行",s[3] and s[3]["inHeader"],(s[3] or {}).get("t"))
    pop.bring_to_front(); pop.click('input[data-key=flow]'); pop.wait_for_timeout(300); pg.bring_to_front(); pg.wait_for_timeout(1000)
    check("关闭流速:全部消失",pg.evaluate("document.querySelectorAll('.fl-flow').length")==0)
    check("流速关闭不影响粉丝徽标",pg.evaluate("document.querySelectorAll('.fl-badge').length")>0)
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
