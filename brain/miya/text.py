"""Matn bilan ishlash: tozalash, so'zlarga bo'lish, o'zak ajratish, HTML'dan matn olish."""
import re
from html.parser import HTMLParser

APOS = str.maketrans({"ʻ": "'", "ʼ": "'", "’": "'", "‘": "'", "`": "'", "´": "'"})
WORD = re.compile(r"[^\W\d_](?:[^\W_]|')*[^\W_]|\d+", re.UNICODE)
SENT = re.compile(r"(?<=[.!?…])\s+(?=[A-ZА-ЯЁЎҚҒҲ0-9\"«(])")

STOP = set("""
va bu u ular bilan uchun ham bir deb esa emas edi ekan bo'lib bo'lgan bo'ladi bo'lsa kabi yoki lekin ammo biroq shu shunday
o'z har qilib qayer qayerga nechta necha nech kimning bormi nimaga mening sening bizning sizning ularning bering qiling yozing ayting yaxshi katta kichik yangi birinchi ikkinchi uchinchi bo'lishi bo'lgani qilish qiladi qilgan eng juda ko'p kam men sen biz siz ul nima qanday nega qachon qayerda qaysi kim mi
da dan ga ni ning yana hali endi faqat hamda agar chunki keyin oldin orqali bor yo'q kerak mumkin ushbu mana hech
the and for are but not you all any can her was one our out has have had this that with from they will would there their
what which when where who how why been were into than then them these those such only also more most some very just
about over after before other its your our his she him
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет
о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя
это для при под над без
""".split())

SUFFIXES = sorted("""
larimizning laringizning larimizga laringizga larimizda larimizdan lardagi laridagi larning larini lariga laridan larida
lardan larga larda larni lari lar imizning ingizning imiz ingiz ning ning dagi dagi idagi sidagi dan tan ga ka qa da ta ni
ini si im ing ish chi lik siz li cha mi gi ki ing ing
""".split(), key=len, reverse=True)


def norm(s: str) -> str:
    return s.translate(APOS).lower()


def words(s: str) -> list[str]:
    return [w.strip("'") for w in WORD.findall(norm(s))]


def stem(w: str) -> str:
    for _ in range(2):
        for suf in SUFFIXES:
            if w.endswith(suf) and len(w) - len(suf) >= 3:
                w = w[: -len(suf)]
                break
        else:
            break
    return w


def terms(s: str) -> list[str]:
    """Qidiruv uchun o'zaklar (to'xtovchi so'zlarsiz)."""
    return [stem(w) for w in words(s) if len(w) >= 3 and w not in STOP and not w.isdigit()]


def sentences(s: str) -> list[str]:
    out = []
    for para in s.split("\n"):
        if para.lstrip().startswith("#"):
            continue
        out += [x.strip() for x in SENT.split(para) if len(x.strip()) > 12]
    return out


class _HTML(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "button", "iframe", "template"}
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "section", "article", "blockquote", "pre", "dd", "dt", "figcaption"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.title, self.links, self.skip, self.in_title = [], "", [], 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self.in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        if tag in self.BLOCK:
            self.out.append("\n")
        if tag in ("h1", "h2", "h3") and not self.skip:
            self.out.append("## ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self.in_title = False
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.out.append(data)


def html_to_text(html: str) -> tuple[str, str, list[str]]:
    """(sarlavha, matn, havolalar)"""
    p = _HTML()
    p.feed(html)
    lines = [re.sub(r"\s+", " ", l).strip() for l in "".join(p.out).split("\n")]
    keep = [l for l in lines if len(l) > 40 or (l.startswith("## ") and len(l) > 5)]
    return re.sub(r"\s+", " ", p.title).strip(), "\n".join(keep), p.links
