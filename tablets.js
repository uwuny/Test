// --- tables.js ---

let DATA = { battles: [] };
let TANK_NAME_MAP = {};  // словарь танков

// --- Подгружаем tank_db.txt ---
fetch("tank_db.txt")
  .then(r => r.text())
  .then(text => {
    text.split("\n").forEach(line => {
      const parts = line.trim().split("\t");
      if(parts.length >= 4){
        const short_name = parts[1];
        const tag = parts[3];
        const tag_clean = tag.split(":").pop();
        TANK_NAME_MAP[tag_clean] = short_name;
      }
    });
    console.log("Словарь танков загружен", TANK_NAME_MAP);
  });

// --- Функция нормализации танка ---
function cleanTankName(code){
  const tag = code.split(":").pop();
  return TANK_NAME_MAP[tag] || tag;
}

// --- Извлечение JSON блоков из .mtreplay ---
function extractJsonBlocks(text){
  let blocks = [];
  let balance = 0, start = null;
  for(let i=0;i<text.length;i++){
    let ch = text[i];
    if(ch=="{"){
      if(balance==0) start=i;
      balance++;
    } else if(ch=="}"){
      balance--;
      if(balance==0 && start!==null){
        blocks.push(text.slice(start,i+1));
      }
    }
  }
  return blocks;
}

// --- Парсинг одного .mtreplay ---
function parseReplay(file, callback){
  const reader = new FileReader();
  reader.onload = e=>{
    try {
      const text = e.target.result;
      const blocks = extractJsonBlocks(text);
      if(blocks.length<2) throw "Нет JSON блоков";

      const meta = JSON.parse(blocks[0]);
      const battle = JSON.parse(blocks[1]);

      const playerName = meta.playerName;
      const vehiclesMeta = meta.vehicles || {};

      const teamTanks = {};
      let myTeam = null;

      for(let vKey in vehiclesMeta){
        let v = vehiclesMeta[vKey];
        if(v.name){
          teamTanks[v.name] = cleanTankName(v.vehicleType);
        }
        if(v.name === playerName) myTeam = v.team;
      }
      if(myTeam===null) throw "Не удалось определить команду";

      const mapName = meta.mapDisplayName || meta.mapName || "Unknown";
      const winnerTeam = meta.winnerTeam || battle.winnerTeam || (battle.common && battle.common.winnerTeam);
      const isWin = (winnerTeam === myTeam);

      const vehiclesStats = battle.vehicles || {};
      const playersMeta = battle.players || {};

      const players = {};

      for(let statsListKey in vehiclesStats){
        const statsList = vehiclesStats[statsListKey];
        if(!statsList || !statsList[0]) continue;
        const stats = statsList[0];
        if(stats.team !== myTeam) continue;

        const accId = String(stats.accountDBID);
        const playerData = playersMeta[accId];
        if(!playerData) continue;
        const nickname = playerData.name;

        players[nickname] = {
          tank: teamTanks[nickname]||"",
          alive: stats.health>0,
          damage: stats.damageDealt||0,
          damage_received: stats.damageReceived||0,
          shots: stats.shots||0,
          hits: stats.directHits||0,
          frags: stats.kills||0,
          spot: stats.spotted||0,
          blocked: stats.damageBlockedByArmor||0,
          piercings: stats.piercings||0,
          assist_radio: stats.damageAssistedRadio||0,
          assist_track: stats.damageAssistedTrack||0
        }
      }

      callback({
        map: mapName,
        win: isWin,
        players: players
      });

    } catch(err){
      console.error("Ошибка парсинга:", file.name, err);
    }
  };
  reader.readAsText(file);
}

// --- Обработка выбора файлов ---
document.getElementById("replayInput").addEventListener("change", e=>{
  const files = Array.from(e.target.files);
  DATA.battles = [];
  let count = 0;

  files.forEach(file=>{
    parseReplay(file, battle=>{
      DATA.battles.push(battle);
      count++;
      if(count===files.length){
        loadTable("damage");
      }
    });
  });
});

// --- Функция построения таблицы ---
function loadTable(type,event){
  if(event) document.querySelectorAll("button").forEach(b=>b.classList.remove("active"));
  if(event) event.target.classList.add("active");

  const battles = DATA.battles;
  const players = {};

  battles.forEach((battle,battleIndex)=>{
    for(let name in battle.players){
      let p = battle.players[name];
      if(!players[name]) players[name] = {};

      let value = 0;
      if(type==="damage") value = p.damage;
      if(type==="damage_received") value = p.damage_received;
      if(type==="hits") value = `${p.shots}/${p.hits}/${p.piercings}`;
      if(type==="assist") value = p.assist_track + p.assist_radio;

      players[name][battleIndex] = {
        tank: p.tank,
        value: value,
        assist_track: p.assist_track,
        assist_radio: p.assist_radio,
        alive: p.alive
      }
    }
  });

  const averages = {};
  for(let name in players){
    let sum=0, count=0;
    battles.forEach((battle,i)=>{
      let cell = players[name][i];
      if(!cell) return;
      let v = cell.value;
      if(typeof v==="number"){ sum+=v; count++; }
    });
    averages[name] = count ? Math.round(sum/count) : 0;
  }

  function getPenRate(name){
    let shots=0, hits=0, pen=0;
    battles.forEach(b=>{
      let p=b.players[name];
      if(!p) return;
      shots+=p.shots; hits+=p.hits; pen+=p.piercings;
    });
    if(hits==0) return 0;
    return pen/hits;
  }

  let sorted = Object.keys(players);
  if(type==="hits") sorted.sort((a,b)=>getPenRate(b)-getPenRate(a));
  else sorted.sort((a,b)=>averages[b]-averages[a]);

  let html = "<table>";
  html+="<tr><th>Ник</th>";
  if(type==="hits") html+="<th>%</th>";
  battles.forEach(b=>{
    let resultClass = b.win ? "win" : "lose";
    let mapName = b.map.replace(" ","<br>");
    html+=`<th class="${resultClass}">${mapName}</th>`;
  });
  if(type!=="hits") html+="<th>Среднее</th>";
  html+="</tr>";

  sorted.forEach(name=>{
    html+="<tr>";
    html+=`<td>${name}</td>`;
    if(type==="hits"){
      let shots=0,hits=0,pen=0;
      battles.forEach(b=>{
        let p=b.players[name]; if(!p) return; shots+=p.shots; hits+=p.hits; pen+=p.piercings;
      });
      let percent = hits ? Math.round(pen/hits*100) : 0;
      html+=`<td>${percent}%</td>`;
    }
    battles.forEach((battle,i)=>{
      let cell = players[name][i];
      if(!cell){ html+="<td></td>"; return; }
      let tankClass = cell.alive ? "alive" : "dead";
      let displayValue = cell.value;
      if(type==="assist") displayValue = `${cell.value}<br><small>каток:${cell.assist_track} / свет:${cell.assist_radio}</small>`;
      html+=`<td><span class="${tankClass}">${cell.tank}</span><br>${displayValue}</td>`;
    });
    if(type!=="hits") html+=`<td>${averages[name]}</td>`;
    html+="</tr>";
  });

  html+="</table>";
  document.getElementById("table").innerHTML = html;
}
