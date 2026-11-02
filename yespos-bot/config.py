import os
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

TZ = ZoneInfo("Asia/Tashkent")

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_IDS = {int(x) for x in os.getenv("ADMIN_IDS", "").replace(" ", "").split(",") if x}

YESPOS_AUTH_URL = "https://m1.yespos.uz"
YESPOS_ORG_ID = os.getenv("YESPOS_ORG_ID", "")
YESPOS_LOGIN = os.getenv("YESPOS_LOGIN", "")
YESPOS_PASSWORD = os.getenv("YESPOS_PASSWORD", "")
YESPOS_BRANCH = int(os.getenv("YESPOS_BRANCH", "1"))
YESPOS_PRICE_TYPE = int(os.getenv("YESPOS_PRICE_TYPE", "1"))

DEBT_DAYS = sorted(int(x) for x in os.getenv("DEBT_DAYS", "7,15,30").split(",") if x.strip())
UNSOLD_DAYS = int(os.getenv("UNSOLD_DAYS", "30"))
SLOW_DAYS = int(os.getenv("SLOW_DAYS", "30"))
DAILY_REPORT_TIME = os.getenv("DAILY_REPORT_TIME", "09:00")
CHECK_INTERVAL_MIN = int(os.getenv("CHECK_INTERVAL_MIN", "60"))

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
