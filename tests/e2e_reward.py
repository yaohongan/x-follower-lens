# -*- coding: utf-8 -*-
"""原创奖励进度 + 粉丝达标预测 + 奖励页原始响应记录。运行:python3 tests/e2e_reward.py"""
import json, tempfile, time, os, hashlib
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM")
ok=True
def check(n,c,e=""):
    global ok; print(("PASS " if c else "FAIL ")+n,e if not c else ""); ok&=bool(c)
REW='''<!doctype html><html><body style="margin:0"><div data-testid="primaryColumn" style="width:600px"><div style="font-size:15px"><span>至少有 500 名已验证粉丝</span> <span>过去 90 天,累积至少 50 万次已验证首页时间线曝光</span></div><div style="font-size:15px">500</div><div style="font-size:30px;font-weight:700"><span>373.1K</span></div><div style="font-size:13px">回复不计入曝光</div></div></body></html>'''
ANA='''<!doctype html><html><body><a data-testid="AppTabBar_Profile_Link" href="/yihui">个人资料</a><script>addEventListener("load",function(){fetch("/i/api/1.1/flow/timeline.json",{method:"POST",body:"{}"}).then(function(r){return r.text()})})</script></body></html>'''
FLOW=json.dumps({"flow_token":"SECRETTOKEN123","subtasks":[{"impressions":[{"date":"2026-11-14","total":128500,"verified":51700}],"note":"x"*200}]})
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"],viewport={"width":700,"height":700})
    ctx.route("https://x.com/i/jf/creators/original_content_rewards",lambda r:r.fulfill(status=200,content_type="text/html",body=REW))
    ctx.route("https://x.com/i/account_analytics",lambda r:r.fulfill(status=200,content_type="text/html",body=ANA))
    ctx.route("https://x.com/i/api/1.1/flow/timeline.json",lambda r:r.fulfill(status=200,content_type="application/json",body=FLOW))
    eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:没有数据时给出引导和入口链接",pop.evaluate("document.getElementById('insight').innerText.includes('还没有数据')") and pop.evaluate("!!document.querySelector('#insight a.ins-link')"))
    # 1. 打开奖励页:读到 373.1K,目标 50 万
    pg=ctx.new_page(); pg.goto("https://x.com/i/jf/creators/original_content_rewards"); pg.wait_for_timeout(4500)
    rec=pop.evaluate("new Promise(r=>chrome.storage.local.get('fl_reward',o=>r(o.fl_reward)))")
    check("打开奖励页:记下累计 373100,目标 500000(不是页面上另一个 500)",rec and rec["v"]==373100 and rec["target"]==500000,rec)
    # 2. 造 7 天历史,弹窗里看进度、预计天数、柱子
    now=int(time.time()*1000); days={}
    import datetime
    for i in range(8):
        d=(datetime.datetime.utcfromtimestamp(now/1000)-datetime.timedelta(days=7-i)).strftime("%Y-%m-%d"); days[d]={"v":373100-(7-i)*8000,"at":now}
    pop.evaluate("(a)=>new Promise(r=>chrome.storage.local.set({fl_reward:a},r))",{"v":373100,"at":now,"target":500000,"days":days})
    pop.reload(); pop.wait_for_timeout(800)
    txt=pop.evaluate("document.getElementById('insight').innerText.replace(/\\n/g,' | ')")
    check("进度卡:74.6%、373.1K / 500K、还差 126.9K",all(s in txt for s in ("74.6%","373.1K","500K","126.9K")),txt)
    check("进度卡:按近 7 天净增 +8K/天,约 16 天后达标,写明是估算",("+8K/天" in txt) and ("约 16 天" in txt) and ("估算" in txt),txt)
    check("进度卡:7 根柱子,并有「净变化,不是当天新增」说明",pop.evaluate("document.querySelectorAll('#insight .bars .bar').length")==7 and ("不是当天新增" in txt),txt)
    # 3. 没有足够天数 → 不乱估
    pop.evaluate("(a)=>new Promise(r=>chrome.storage.local.set({fl_reward:a},r))",{"v":373100,"at":now,"target":500000,"days":{datetime.datetime.utcfromtimestamp(now/1000).strftime("%Y-%m-%d"):{"v":373100,"at":now}}})
    pop.reload(); pop.wait_for_timeout(800)
    txt=pop.evaluate("document.getElementById('insight').innerText")
    check("只有 1 天数据:不估算,提示再记几天",("约" not in txt.split("还差")[1].split("柱子")[0] or "再多记" in txt) and "再多记" in txt,txt)
    # 4. 账号分析页:记下 flow 响应,令牌被隐去;顺便记下我自己的账号
    pg2=ctx.new_page(); pg2.goto("https://x.com/i/account_analytics"); pg2.wait_for_timeout(4500)
    fd=pop.evaluate("new Promise(r=>chrome.storage.local.get(['fl_flowdiag','fl_me'],o=>r(o)))")
    one=(fd.get("fl_flowdiag") or [None])[-1]
    check("账号分析页:原始响应被记下(含 impressions),flow_token 已隐去",one and "impressions" in one["body"] and "SECRETTOKEN123" not in one["body"] and "已隐去" in one["body"],one and one["body"][:120])
    check("记下我自己的账号 @yihui",fd.get("fl_me")=="yihui",fd.get("fl_me"))
    # 5. 粉丝达标预测
    now=int(time.time()*1000)
    pop.evaluate("(h)=>new Promise(r=>chrome.storage.local.set({fl_hist:h},r))",{"yihui":[[now-6*86400000,2300],[now-3*86400000,2400],[now,2501]]})
    pop.reload(); pop.wait_for_timeout(800)
    txt=pop.evaluate("document.getElementById('insight').innerText.replace(/\\n/g,' | ')")
    check("粉丝达标预测:2,501 位,近 6 天约 +33.5/天,下一档 3,000,约 15 天",all(s in txt for s in ("粉丝达标预测","2,501","3,000","约 15 天")),txt)
    # 6. 关掉开关:不再记录
    pop.evaluate("(()=>new Promise(r=>chrome.storage.local.get('fl_settings',o=>{const s=o.fl_settings||{};s.rewardCard=false;chrome.storage.local.set({fl_settings:s,fl_reward:null},r)})))()")
    pg.reload(); pg.wait_for_timeout(4500)
    rec=pop.evaluate("new Promise(r=>chrome.storage.local.get('fl_reward',o=>r(o.fl_reward))) ")
    check("关掉「记录原创奖励进度」:再打开奖励页不记录",not rec,rec)
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
