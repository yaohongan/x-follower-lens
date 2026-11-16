# -*- coding: utf-8 -*-
"""每天自动更新:打开 x.com 任何页面后,后台悄悄开奖励页和账号分析页,读完自动关掉;关掉开关则不开。运行:python3 tests/e2e_rewardauto.py"""
import json, tempfile, time, os, hashlib, datetime, ssl, threading, subprocess, http.server
from playwright.sync_api import sync_playwright
EXT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE=os.environ.get("CHROMIUM")
ok=True
def check(n,c,e=""):
    global ok; print(("PASS " if c else "FAIL ")+n,e if not c else ""); ok&=bool(c)
def utc_day(back): return (datetime.datetime.utcnow()-datetime.timedelta(days=back)).strftime("%Y-%m-%d")
def ts(day): return int(datetime.datetime.strptime(day,"%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
series=[]
for back in (1,2,3,4):
    d=utc_day(back); series+=[{"count":1000*back,"engagement_type":"Displayed","is_engaging_user_verified":"false","timestamp":ts(d)},{"count":500*back,"engagement_type":"Displayed","is_engaging_user_verified":"true","timestamp":ts(d)}]
AO=json.dumps({"data":{"viewer_v2":{"user_results":{"result":{"current_time_series":series,"pad":"x"*40}}}}})
REW='''<!doctype html><html><body><div data-testid="primaryColumn"><p>过去 90 天内,累积至少 50 万次已验证首页时间线曝光</p><p>373.1K</p><p>回复不计入曝光</p></div></body></html>'''
ANA='''<!doctype html><html><body><script>addEventListener("load",function(){fetch("/i/api/graphql/abc123/accountOverviewDailyQuery?variables=%7B%7D").then(function(r){return r.text()})})</script></body></html>'''
HOME='<!doctype html><html><body><div id="x">home</div></body></html>'

TMP=tempfile.mkdtemp()
subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",TMP+"/k.pem","-out",TMP+"/c.pem","-days","2","-subj","/CN=x.com","-addext","subjectAltName=DNS:x.com"],check=True,capture_output=True)
hits={"reward":0,"daily":0,"home":0}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        path=self.path.split("?")[0]
        if path=="/i/jf/creators/original_content_rewards": hits["reward"]+=1; ct,b="text/html",REW
        elif path=="/i/account_analytics": hits["daily"]+=1; ct,b="text/html",ANA
        elif path=="/i/api/graphql/abc123/accountOverviewDailyQuery": ct,b="application/json",AO
        elif path=="/home": hits["home"]+=1; ct,b="text/html",HOME
        else: self.send_response(404); self.end_headers(); return
        d=b.encode(); self.send_response(200); self.send_header("Content-Type",ct+"; charset=utf-8"); self.send_header("Content-Length",str(len(d))); self.end_headers(); self.wfile.write(d)
srv=http.server.ThreadingHTTPServer(("127.0.0.1",8443),H)
sc=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); sc.load_cert_chain(TMP+"/c.pem",TMP+"/k.pem"); srv.socket=sc.wrap_socket(srv.socket,server_side=True)
threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=True,args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}","--host-resolver-rules=MAP x.com 127.0.0.1:8443","--ignore-certificate-errors","--no-proxy-server"],viewport={"width":700,"height":500})
    eid="".join(chr(ord("a")+int(c,16)) for c in hashlib.sha256(EXT.encode()).hexdigest()[:32])
    pop=ctx.new_page(); pop.goto(f"chrome-extension://{eid}/popup.html"); pop.wait_for_timeout(600)
    check("弹窗:「每天自动更新」默认关",pop.evaluate("!document.querySelector('input[data-key=rewardAuto]').checked"))
    # 1. 关着:打开 X 页面,后台不开任何页面
    pg=ctx.new_page(); pg.goto("https://x.com/home"); pg.wait_for_timeout(9000)
    check("开关关着:打开 x.com 后,后台没有去开奖励页/分析页",hits["reward"]==0 and hits["daily"]==0,hits)
    pg.close()
    # 2. 打开开关,清空数据
    pop.click('input[data-key=rewardAuto]'); pop.wait_for_timeout(400)
    pop.evaluate("new Promise(r=>chrome.storage.local.remove(['fl_reward','fl_daily','fl_auto'],r))")
    pg=ctx.new_page(); pg.goto("https://x.com/home")
    t0=time.time()
    while time.time()-t0<60:
        got=pop.evaluate("new Promise(r=>chrome.storage.local.get(['fl_reward','fl_daily'],o=>r({r:!!(o.fl_reward&&o.fl_reward.v),d:!!(o.fl_daily&&o.fl_daily.days&&Object.keys(o.fl_daily.days).length)})))")
        if got["r"] and got["d"]: break
        pg.wait_for_timeout(1500)
    rec=pop.evaluate("new Promise(r=>chrome.storage.local.get(['fl_reward','fl_daily'],o=>r(o)))")
    check("自动更新:奖励累计 373100 已记下",rec.get("fl_reward") and rec["fl_reward"]["v"]==373100,rec.get("fl_reward"))
    check("自动更新:每日曝光已记下(昨天 整体 1500、蓝 V 500)",rec.get("fl_daily") and rec["fl_daily"]["days"].get(utc_day(1))=={"t":1500,"v":500},rec.get("fl_daily"))
    pg.wait_for_timeout(3000)
    left=[u.url for u in ctx.pages if "fl_auto" in u.url]
    check("读完自动关掉后台标签页(没有残留的 fl_auto 页面)",not left,left)
    check("每个页面只开了一次",hits["reward"]==1 and hits["daily"]==1,hits)
    a=pop.evaluate("new Promise(r=>chrome.storage.local.get('fl_auto',o=>r(o.fl_auto)))")
    check("记录了今天的尝试次数(1 次)",a and a["tries"]==1,a)
    # 3. 数据都齐了:再等一轮也不再开
    pg.wait_for_timeout(1000); before=dict(hits)
    pg.reload(); pg.wait_for_timeout(9000)
    check("今天的数据已齐:再打开 x.com 也不再后台开页面",(hits["reward"],hits["daily"])==(before["reward"],before["daily"]),(before,hits))
    ctx.close()
print("ALL PASS" if ok else "SOME FAIL")
