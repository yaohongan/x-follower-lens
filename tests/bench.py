"""性能基准:用重度页面量主线程长任务(>50ms)总时长。
运行:python3 tests/bench.py [扩展目录 或 none]   例:python3 tests/bench.py none"""
import json, tempfile, time, os, sys, re, random
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT=sys.argv[1] if len(sys.argv)>1 else HERE
EXE=os.environ.get("CHROMIUM","/Users/yaohongan/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
random.seed(7)
now=time.time(); ago=lambda h: time.strftime("%a %b %d %H:%M:%S +0000 %Y", time.gmtime(now-h*3600))
FILL="x"*1800
def user(i): return {"__typename":"User","rest_id":str(i),"core":{"screen_name":f"user{i}","name":f"User {i}","created_at":"Mon Jan 01 00:00:00 +0000 2016"},"relationship_counts":{"followers":random.randint(50,900000),"following":random.randint(20,5000)},"relationship_perspectives":{"followed_by":i%3==0,"following":i%5==0},"tweet_counts":{"tweets":1234},"profile_bio":{"description":random.choice(["程序员 独立开发 Vibe Coding 出海","AI视频 影视视效 工具实测","Web3 crypto BTC 空投","大模型 研究员 论文 LLM","自媒体 涨粉 运营 公众号","设计师 Midjourney 生图 视觉"])+" 日常记录"},"extra":FILL}
def tweet(i,u): return {"__typename":"Tweet","rest_id":str(1000+i),"views":{"count":str(random.randint(100,90000))},"legacy":{"favorite_count":random.randint(0,500),"retweet_count":1,"reply_count":2,"quote_count":0,"full_text":random.choice(["今天用 Cursor 写了一个 agent 工作流 做自动化","BTC 又涨了 链上数据很强 空投值得冲","可灵 即梦 Sora 视频生成对比 实测","美股 财报 投资 宏观 思考"])+" "+FILL[:600],"created_at":ago(random.uniform(0.3,20)),"entities":FILL},"core":{"user_results":{"result":u}}}
RELEVANT=["HomeTimeline","HomeLatestTimeline","Following","UserTweets","TweetDetail","SearchTimeline","Followers","UserTweetsAndReplies"]
NOISE=[f"Noise{k}" for k in range(26)]
def payload(op):
    if op in RELEVANT:
        us=[user(random.randint(1,119)) for _ in range(60)]
        return json.dumps({"data":{"timeline":[tweet(j,us[j%60]) for j in range(45)]+us}})
    return json.dumps({"data":{"items":[{"__typename":"User","rest_id":str(k),"core":{"screen_name":f"n{k}"},"pad":FILL} for k in range(55)]}})
CACHE={op:payload(op) for op in RELEVANT+NOISE}
print("总负载:",round(sum(len(v) for v in CACHE.values())/1e6,2),"MB;相关",len(RELEVANT),"个,无关",len(NOISE),"个")
def art(i,h): return f'''<article data-testid="tweet" style="position:relative;width:548px;padding:14px;box-sizing:border-box"><div style="display:flex;gap:10px"><div data-testid="UserAvatar-Container-{h}" style="position:relative;width:40px;height:40px;flex:none"><div style="position:absolute;inset:0;overflow:hidden;border-radius:9999px;background:#94a3b8"><img style="width:40px;height:40px" alt=""></div></div>
<div style="display:flex;flex-direction:column;width:460px"><div style="display:flex;justify-content:space-between;width:460px"><div style="display:flex"><div style="display:flex;flex-direction:column"><div data-testid="User-Name" style="display:flex"><div><a role="link" href="/{h}">{h}</a></div><div><a role="link" href="/{h}">@{h}</a><a href="/{h}/status/{1000+i}"><time>2h</time></a></div></div></div></div><div style="display:flex;width:46px"><button>m</button></div></div>
<div>tweet body {i}</div><div role="group" style="display:flex"><div style="display:flex;width:111px"><a role="link" href="/{h}/status/{1000+i}/analytics">1</a></div></div></div></div></article>'''
ARTS="".join(art(i,f"user{i%119+1}") for i in range(60))
OPS=RELEVANT+NOISE
HTML=f'''<!doctype html><html><body style="margin:0"><div id="r"></div><div id="noise"></div><script>
addEventListener("load",function(){{
  document.getElementById("r").innerHTML={json.dumps(ARTS)};
  var ops={json.dumps(OPS)};
  ops.forEach(function(op,i){{ setTimeout(function(){{ var x=new XMLHttpRequest(); x.open("GET","/i/api/graphql/abc123/"+op+"?v=1"); x.send(); }}, 20*i); }});
  // 模拟 X 持续不断的页面变动(计时器、悬停、视频进度……)
  var n=0; var t=setInterval(function(){{ var s=document.createElement("span"); s.textContent=n++; document.getElementById("noise").appendChild(s); if(n>1){{document.getElementById("noise").firstChild.remove()}} if(n>80) clearInterval(t) }}, 50);
}});
</script></body></html>'''
INIT="""window.__lt=[];try{new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({type:'longtask',buffered:true})}catch(e){}
window.__fb=null;window.__fc=null;window.__fr=null;new MutationObserver(()=>{const n=Math.round(performance.now());if(window.__fb===null&&document.querySelector('.fl-badge'))window.__fb=n;if(window.__fc===null&&document.querySelector('.fl-flow'))window.__fc=n;if(window.__fr===null&&document.querySelector('.fl-ring'))window.__fr=n}).observe(document,{childList:true,subtree:true});"""
def run():
    with sync_playwright() as p:
        args=["--no-first-run"]
        if EXT!="none": args=[f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"]
        ctx=p.chromium.launch_persistent_context(tempfile.mkdtemp(),executable_path=EXE,headless=False,args=args,viewport={"width":900,"height":900})
        ctx.add_init_script(INIT)
        def api(r):
            op=re.search(r"/graphql/[^/]+/([^?]+)",r.request.url).group(1); r.fulfill(status=200,content_type="application/json",body=CACHE[op])
        ctx.route("https://x.com/i/api/**",api); ctx.route("https://x.com/home",lambda r:r.fulfill(status=200,content_type="text/html",body=HTML))
        pg=ctx.new_page()
        if os.environ.get("BENCH_REDUCED"): pg.emulate_media(reduced_motion="reduce")
        cdp=ctx.new_cdp_session(pg); cdp.send("Performance.enable")
        pg.goto("https://x.com/home"); pg.wait_for_timeout(9000)
        m={x["name"]:x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
        ms=lambda k: round(m.get(k,0)*1000)
        r=pg.evaluate("({sum:Math.round(window.__lt.reduce((a,b)=>a+b,0)),n:window.__lt.length,max:Math.round(Math.max(0,...window.__lt)),firstBadge:window.__fb,firstChip:window.__fc,firstRing:window.__fr,badges:document.querySelectorAll('.fl-badge').length,chips:document.querySelectorAll('.fl-flow').length,rings:document.querySelectorAll('.fl-ring').length})")
        r.update({"script":ms("ScriptDuration"),"layout":ms("LayoutDuration"),"style":ms("RecalcStyleDuration"),"task":ms("TaskDuration")})
        ctx.close(); return r
res=[run() for _ in range(3)]
for r in res: print(r)
avg=lambda k: round(sum(r[k] for r in res)/3)
print(f"平均 主线程总耗时 {avg('task')}ms  = 脚本 {avg('script')} + 布局 {avg('layout')} + 样式重算 {avg('style')}(ms) | 首个徽标 {[r['firstBadge'] for r in res]} 首个流速标 {[r['firstChip'] for r in res]} 首个光环 {[r['firstRing'] for r in res]} (ms)")
