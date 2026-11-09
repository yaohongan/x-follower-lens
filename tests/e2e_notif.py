"""新粉丝提醒:通知页里,"关注了你"的人旁边显示粉丝数和标签,粉丝数达到提醒线的整条高亮。
运行:python3 tests/e2e_notif.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
def user(h,f,g=100):
    return {"__typename":"User","rest_id":h,"core":{"screen_name":h,"name":h,"created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":f,"following":g},"relationship_perspectives":{"followed_by":True,"following":False}}
def notif(i,icon,users): return {"content":{"itemContent":{"__typename":"TimelineNotification","id":str(i),"notification_icon":icon,"template":{"from_users":[{"user_results":{"result":u}} for u in users]}}}}
big=user("bigguy",52000,300); mid=user("midguy",3300,200); small=user("smallguy",80,60); liker=user("likerguy",70000,100); extra=[user(f"x{i}",100+i) for i in range(4)]
entries=[notif(1,"person_icon",[big]),                       # 大号关注了你
         notif(2,"person_icon",[mid,small]),                 # 两位普通粉丝
         notif(3,"heart_icon",[liker]),                      # 点赞:不是关注,不该有任何标记(即使 7 万粉)
         notif(4,"person_icon",[big]+extra)]                 # 一次关注了 5 个人:最多显示 3 位 + "还有 N 位"
data=json.dumps({"data":{"viewer":{"timeline":{"instructions":[{"entries":entries}]}}}})
PERSON='<svg width="20" height="20"><path d="M17.863 13.44c1.477 1.58 2.3z"/></svg>'
HEART='<svg width="20" height="20"><path d="M20.884 13.19c-1.351 2.48-4.z"/></svg>'
def art(h_list,svg=None): return '<article data-testid="notification" style="padding:12px 16px;border-bottom:1px solid #ddd">'+(svg or PERSON)+'<div>'+"".join(f'<a href="/{h}">@{h}</a> ' for h in h_list)+'<span>关注了你</span></div></article>'
HTML='<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:600px"><div id=r></div><script>addEventListener("load",function(){document.getElementById("r").innerHTML='+json.dumps(art(["bigguy"])+art(["midguy","smallguy"])+art(["likerguy"],HEART)+art(["bigguy","x0","x1","x2","x3"])+art(["bigguy"],HEART))+';var x=new XMLHttpRequest();x.open("GET","/i/api/graphql/h/NotificationsTimeline");x.send()})</script></body></html>'
ok=True
def check(n,c,e=""):
    global ok; ok&=bool(c); print(("PASS " if c else "FAIL ")+n,e)
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":900})
    ctx.route("https://x.com/i/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body=data))
    ctx.route("https://x.com/notifications",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
    errs=[]; pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("https://x.com/notifications"); pg.wait_for_timeout(2500)
    S=lambda: pg.evaluate("[...document.querySelectorAll('article')].map(a=>({vip:a.classList.contains('fl-notif-vip'),row:a.querySelector('.fl-notif-row')?a.querySelector('.fl-notif-row').innerText.replace(/\\n/g,' '):null,items:a.querySelectorAll('.fl-notif-item').length,badges:a.querySelectorAll('.fl-notif-row .fl-badge').length}))")
    s=S(); print(json.dumps(s,ensure_ascii=False)[:500])
    check("大号(5.2 万粉)关注了你:整条高亮,带「⭐ @bigguy」和粉丝数徽标",s[0]["vip"] and s[0]["row"] and "⭐ @bigguy" in s[0]["row"] and "5.2万 粉丝" in s[0]["row"],s[0]["row"])
    check("两位普通粉丝:都显示粉丝数,不高亮(3300 / 80 都没到 1 万)",(not s[1]["vip"]) and s[1]["items"]==2 and s[1]["badges"]==2 and "3300 粉丝" in s[1]["row"] and "80 粉丝" in s[1]["row"],s[1]["row"])
    check("点赞通知(那位有 7 万粉)不是关注:没有任何标记",s[2]["row"] is None and not s[2]["vip"],s[2])
    check("同一个大号(@bigguy)后来又点了赞:那条点赞通知(第 5 条)不标记,只有关注通知才标",s[4]["row"] is None and not s[4]["vip"],s[4])
    check("一次关注了 5 个人:最多显示 3 位,其余写「…还有 2 位」,按粉丝数从多到少排",s[3]["items"]==3 and "还有 2 位" in s[3]["row"] and s[3]["row"].index("bigguy")<s[3]["row"].index("x3"),s[3]["row"])
    pg.hover('article:nth-of-type(1) .fl-notif-row .fl-badge'); pg.wait_for_timeout(300)
    tip=pg.evaluate("(()=>{const t=document.getElementById('fl-tip');return t&&t.style.display!=='none'?t.innerText:null})()")
    check("鼠标放在新粉丝的徽标上:出现详情卡(账号状态栏等)",tip and "@bigguy" in tip and "账号状态" in tip,tip and tip[:60])
    pg.mouse.move(2,2)
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:新粉丝提醒默认开,提醒线默认 10000",pop.evaluate("document.querySelector('input[data-key=notifyMark]').checked&&document.getElementById('notifyLine').value==='10000'"))
    pop.fill('#notifyLine','3300'); pop.wait_for_timeout(700); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=S(); check("提醒线改成 3300:3300 粉的 @midguy 那条也高亮了",s[1]["vip"] and "⭐ @midguy" in s[1]["row"],s[1]["row"])
    pop.bring_to_front(); pop.fill('#notifyLine','2万'); pop.wait_for_timeout(700); pg.bring_to_front(); pg.wait_for_timeout(1200)
    s=S(); check("提醒线写「2万」(=20000):@midguy 不高亮,5.2 万的仍然高亮",(not s[1]["vip"]) and s[0]["vip"],(s[1]["vip"],s[0]["vip"]))
    pop.bring_to_front(); pop.click('input[data-key=notifyMark]'); pop.wait_for_timeout(400); pg.bring_to_front(); pg.wait_for_timeout(1200)
    check("关掉开关:所有标记消失",pg.evaluate("!document.querySelector('.fl-notif-row')&&!document.querySelector('.fl-notif-vip')"))
    check("无页面报错",not errs,errs)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
