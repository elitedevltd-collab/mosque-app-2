#!/usr/bin/env python3
"""مراقب بث الخطبة الحية من Firebase — يسجل كل نص جديد في ملف log مع الطابع الزمني."""
import json
import time
import urllib.request

URL = "https://mosqa-app-default-rtdb.asia-southeast1.firebasedatabase.app/sermon.json"
LOG = "/home/ubuntu/mosque-app/sermon_live_log.txt"

last_text = None
print("بدء مراقبة البث الحي... (Ctrl+C للإيقاف)")
while True:
    try:
        with urllib.request.urlopen(URL, timeout=10) as r:
            d = json.load(r)
        text = (d or {}).get("text", "")
        if text and text != last_text:
            last_text = text
            stamp = time.strftime("%H:%M:%S")
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(f"\n===== [{stamp}] =====\n{text}\n")
            print(f"[{stamp}] نص جديد ({len(text)} حرف)")
    except Exception as e:
        print("خطأ:", e)
    time.sleep(1.5)
