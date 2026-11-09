"""用 store/listing.md 重新生成「上架填表助手.html」。
运行:python3 store/build_helper.py <输出文件夹> <安装包文件名>
把 listing.md 里的文字抽出来,填进助手页里的复制框;截图/图标路径指向输出文件夹里的「截图」子文件夹。"""
import re, json, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
zipname = sys.argv[2]
L = open(os.path.join(HERE, "listing.md"), encoding="utf-8").read()


def block_after(marker):
    i = L.index(marker)
    a = L.index("```", i) + 3
    b = L.index("```", a)
    return L[a:b].strip("\n")


def line_after(marker):
    i = L.index(marker) + len(marker)
    return L[i:].lstrip("\n").split("\n", 1)[0].strip()


def row(prefix):
    for l in L.split("\n"):
        if l.startswith(prefix):
            return l.split("|")[2].strip()
    raise KeyError(prefix)


V = [
    "粉丝透镜 Follower Lens",
    line_after("**摘要(Summary,≤132 字符)**"),
    block_after("**详细说明(Description,中文)**"),
    "https://github.com/yaohongan/x-follower-lens",
    "https://github.com/yaohongan/x-follower-lens/issues",
    block_after("**单一用途说明(Single purpose)**"),
    row("| storage |"),
    row("| 内容脚本"),
    block_after("**隐私政策 URL**"),
]

h = open(os.path.join(HERE, "上架填表助手.html"), encoding="utf-8").read()
h = re.sub(r"const V=\[.*?\];\n", lambda m: "const V=" + json.dumps(V, ensure_ascii=False) + ";\n", h, count=1, flags=re.S)
h = re.sub(r"<code>x-follower-lens-[\d.]+\.zip</code>(.*?)</li>", f"<code>{zipname}</code>(就在这个文件夹里)</li>", h, count=1)
h = h.replace("(之前提交过 0.2.3)", "(之前提交过旧版)")
h = h.replace("<code>x-follower-lens/icons/icon128.png</code>", "<code>截图/icon128.png</code>")
h = h.replace("<code>x-follower-lens/store</code> 文件夹里的 <code>screenshot-1.png</code> 到 <code>screenshot-5.png</code>", "<code>截图</code> 文件夹里的 <code>screenshot-1.png</code> 到 <code>screenshot-5.png</code>(共 5 张,1280×800)")
h = h.replace("<code>x-follower-lens/store/promo-440x280.png</code>", "<code>截图/promo-440x280.png</code>")
open(os.path.join(out_dir, "上架填表助手.html"), "w", encoding="utf-8").write(h)
print("ok", len(V))
