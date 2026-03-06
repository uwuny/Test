# main.py
import os
import json
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# ---- база танков ----
TANK_NAME_MAP = {}
with open("tank_db.txt", "r", encoding="utf-8") as f:
    for line in f:
        parts = line.strip().split("\t")
        if len(parts) >= 4:
            short_name = parts[1]
            tag = parts[3]
            tag_clean = tag.split(":")[-1]
            TANK_NAME_MAP[tag_clean] = short_name


def clean_tank_name(code):
    code = code.split(":")[-1]
    return TANK_NAME_MAP.get(code, code)


def extract_json_blocks(text):
    blocks = []
    balance = 0
    start = None
    for i, ch in enumerate(text):
        if ch == "{":
            if balance == 0:
                start = i
            balance += 1
        elif ch == "}":
            balance -= 1
            if balance == 0 and start is not None:
                blocks.append(text[start:i + 1])
    return blocks


def parse_replay_bytes(file_bytes):
    text = file_bytes.decode("utf-8", errors="ignore")
    blocks = extract_json_blocks(text)
    if len(blocks) < 2:
        raise ValueError("Replay не содержит JSON")
    meta = json.loads(blocks[0])
    battle = json.loads(blocks[1])

    player_name = meta.get("playerName")
    vehicles_meta = meta.get("vehicles", {})

    team_tanks = {}
    my_team = None

    for v in vehicles_meta.values():
        name = v.get("name")
        tank_code = v.get("vehicleType", "")
        if name:
            team_tanks[name] = clean_tank_name(tank_code)
        if name == player_name:
            my_team = v.get("team")

    if my_team is None:
        raise ValueError("Не удалось определить команду")

    map_name = meta.get("mapDisplayName") or meta.get("mapName") or "Unknown"

    winner_team = (
        meta.get("winnerTeam")
        or battle.get("winnerTeam")
        or battle.get("common", {}).get("winnerTeam")
    )

    is_win = (winner_team == my_team)

    vehicles_stats = battle.get("vehicles", {})
    players_meta = battle.get("players", {})

    players = {}
    for stats_list in vehicles_stats.values():
        if not stats_list:
            continue
        stats = stats_list[0]
        if stats.get("team") != my_team:
            continue
        acc_id = str(stats.get("accountDBID"))
        player_data = players_meta.get(acc_id)
        if not player_data:
            continue
        nickname = player_data.get("name")
        players[nickname] = {
            "tank": team_tanks.get(nickname, ""),
            "alive": stats.get("health", 0) > 0,
            "damage": stats.get("damageDealt", 0),
            "damage_received": stats.get("damageReceived", 0),
            "shots": stats.get("shots", 0),
            "hits": stats.get("directHits", 0),
            "frags": stats.get("kills", 0),
            "spot": stats.get("spotted", 0),
            "blocked": stats.get("damageBlockedByArmor", 0),
            "piercings": stats.get("piercings", 0),
            "assist_radio": stats.get("damageAssistedRadio", 0),
            "assist_track": stats.get("damageAssistedTrack", 0)
        }

    return {
        "map": map_name,
        "win": is_win,
        "players": players
    }

# ---- FastAPI сервер ----

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # можно ограничить до своего фронтенда
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/upload")
async def upload_replay(file: UploadFile = File(...)):
    if not file.filename.endswith(".mtreplay"):
        return JSONResponse(status_code=400, content={"error": "Неверный тип файла"})
    try:
        file_bytes = await file.read()
        result = parse_replay_bytes(file_bytes)
        return JSONResponse(content=result)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
