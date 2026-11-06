# Room location: kaise kaam karta hai (step by step)

Ye wahi cheez hai jo `docs/ROOM_LOCATION_PLAN.md` mein plan thi, ab banayi gayi. Neeche har step bataya hai: kya hota hai, **kyun**, aur code kahan hai.

## Badi tasveer
```
Phone (Stashr Location 1.7.0, Room Lab)         Server                              Website / Telegram / Tablet
  sunta hai: Wi-Fi + Bluetooth     ──scan──▶   ids ka hash, kamra pehchanna   ──▶   "Papa abhi Kitchen mein (82%)"
  "Main yahan hoon: Kitchen" ──training──▶     samples save, accuracy napna        Room Lab card, map, Q&A
```

## Step 1: Scan (phone kya "sunta" hai)
- Phone aas-paas ke **Wi-Fi networks** (aapka router, padosiyon ke, hotspot) aur **Bluetooth devices** ki signal taqat (dBm) padhta hai. Ek scan aisi list hai: `{ network-A: -48, network-B: -71, device-C: -80 }`.
- Har kamre mein ye list thodi alag hoti hai, kyunki deewarein aur doori signal badal deti hain. Yahi kamre ki "ungli ki chhaap" hai.
- **Privacy:** network ke naam kabhi nahi bheje jaate. Server pehchan ko turant ek hash (`sha256(owner + id)`) mein badal deta hai; asli address database mein jaata hi nahi (`server/utils/roomModel.js: hashId`).
- Android ki hadein: naya Wi-Fi scan thodi baar hi shuru ho sakta hai (har 2 minute mein kuch), isliye kamra badalne ke kuch second-minute baad pata chalta hai. Code: `where-app/.../work/RoomScan.kt`.

## Step 2: Training ("Main yahan hoon")
- Aap kamre mein khade hoke Room Lab mein button dabate ho. Phone 15 second sunta hai, jitne **alag** Wi-Fi nateeje milte hain (sab) aur Bluetooth devices, sab us kamre ke naam se bhej deta hai.
- Har kamre mein **4-5 alag jagah** karo (bed ke paas, darwaze ke paas…). Kam se kam 5 scan har kamre ke liye.
- Ye **samples** hain. Har phone ke apne samples hote hain, kyunki har phone ka radio thoda alag naapta hai.

## Step 3: Pehchan (saare samples vote karte hain)
Naye scan ko **har** sample se milaya jata hai (sirf paas wale 3 se nahi):
1. **Doori** = do scans kitne alag hain: har network ka dBm ka fark, uska varg, average, phir varg-mool. Jo network ek mein sunayi de aur doosre mein nahi, use `-100` maana jata hai ("sunayi hi nahi diya"). Bluetooth ka wazan Wi-Fi se kam (0.6), kyunki phones/earbuds ka address badalta rehta hai.
2. **Wazan** = `exp(-(doori / chaudai)²)`. Bahut milta-julta sample ka wazan ~1, door wale ka ~0. Chaudai itni rakhi jati hai ki koi bhi sample poori tarah gayab na ho.
3. **Umr:** purane sample ka asar dheere kam hota hai (30 din mein aadha), taaki router ya furniture hilne ka purana data beech mein na aaye.
4. **Kamre ka score** = us kamre ke samples ke wazan ka **average** (jod nahi, taaki jis kamre mein zyada samples hain wo sirf zyada hone se na jeete).
5. Scores ko jod ke 100% banaya jata hai: yahi **confidence** hai.

## Step 4: "Pakka nahi" bolna aur kamra badalna
- Agar sabse upar wale kamre ka % **50% se kam** ho, ya koi sample bhi jaana-pehchana na lage (sabse paas wala bhi 30 dBm se zyada alag), to jawab hai **"pakka nahi"**, galat pakka jawab nahi.
- **Smoothing:** ek scan se kamra nahi badalta. Naya kamra **lagaatar 2 baar** jeete tabhi badalta hai. Beech mein "pakka nahi" aaye to ginti toot jati hai. Isse ek shor wale scan se banda "ud ke wapas aata" nahi dikhta.
- Kamra badalne par timeline mein ek line likhi jaati hai ("Papa: Bedroom → Kitchen"), Telegram par nahi (bahut zyada ho jayega).

## Step 5: Sahi-galat ka hisaab (accuracy)
- Har training scan ko **chhupa ke** (aur uske saath us tap ke baaki scans bhi) baaki samples se guess karwate hain. Jitne sahi, wahi accuracy.
- Saath mein **confusion table**: asli kamra x guess kiya gaya kamra. Isse dikhta hai ki Kitchen ko Hall se kitni baar mix kiya.
- Verdict: 85%+ "Good", 65-85% "Fair", usse kam "Weak" (tab zyada jagah se train karo, ya har kamre mein ek purana phone Bluetooth beacon banake rakho).
- Ye hisaab aapke ghar ka asli napne wala hai, kisi aur ghar ke aankde nahi.

## Step 6: Khud behtar hona
- **"Galat hai, main X mein hoon"** (phone ke Room Lab mein): wo scan sahi naam ke saath naya sample ban jata hai.
- Har kamre ke 80 sabse naye samples rakhe jaate hain; purane ghat jaate hain. 120 din baad sample apne aap hat jaate hain.
- Naye samples jodte raho jab furniture ya router badle: model apne aap naye data par chalega.

## Jo dikhta hai
- **Website → Smart home → Insights:** "Kamre ki pehchan (Room Lab)": kamre banao, har phone ka training, accuracy, confusion table. "Ghar ka map" mein kamre blocks ban jaate hain, aur har banda us kamre mein dikhta hai.
- **Telegram / assistant:** "Papa kis room mein hai", "kaun kis room mein hai".
- **Timeline:** kamra badalne wali lines.

## Abhi kya nahi bana (sach)
- **Tablet par pehchan:** abhi pehchan **server par** hoti hai (phone scan bhejta hai). Tablet par local pehchan (server band ho to bhi) alag step hai.
- **Magnetometer / barometer:** plan mein tha, abhi nahi lagaya. Data se pata chale ki zarurat hai to jodenge.
- **Bluetooth beacons** (purane phones ko har kamre mein rakhna): abhi sirf wahi Bluetooth devices sune jaate hain jo kamre mein pehle se hain (TV, speaker, bulb). Beacon wala hissa alag.
- **Foreground service:** background mein naya Wi-Fi scan nahi chalta (koi notification nahi). Normal checks ke saath Android ka jo Wi-Fi nateeja pehle se hai wahi jaata hai (10 minute se purana nahi), aur Bluetooth sirf tab jab aap allow karo.

## Start model, live values, aur accuracy (web aur tablet par ek jaisa)
- **Start / Stop model:** website (Smart home → Insights → "ROOM MODEL") aur tablet (Stashr Hub → Ghar ka map → "Room model", ya Telegram par "room model dikhao") dono par ek button. Start dabane par jin phones ne kam se kam 2 kamre train kiye hain unka room location on ho jata hai, aur unhe turant scan bhejne ko kaha jata hai (push). Jinhone train nahi kiya unka naam aur wajah dikhti hai.
- **Phone khud follow karta hai:** server ke har jawab mein `roomOn` hota hai. Start/Stop dabane ke baad phone ko kuch karna nahi padta.
- **Live values** (har 4-5 second mein, web aur tablet par **ek hi endpoint** se, isliye hamesha ek jaise): kamra, har kamre ka %, pakka kitna, sabse paas ke sample ki doori (dBm), kitne Wi-Fi/Bluetooth sune, kitne samples, aakhri scan kitne second pehle.
- **Do accuracy, dono asli:**
  1. *chhupa ke guess:* har training scan ko chhupa ke baaki se guess (offline hisaab);
  2. *asli accuracy:* phone ke Room Lab mein "Sahi hai ✓" aur "Galat hai, main X mein hoon" ke aapke taps (sahi / (sahi+galat)).
- **99.99% ka vaada nahi:** koi Wi-Fi/Bluetooth tareeka isse pakka nahi hota. Jo dikhta hai wahi napa hua hai. Accuracy badhane ke liye: har kamre mein zyada alag jagah se training, aur har kamre mein ek purana phone Bluetooth beacon ki tarah.

## Sirf ek phone par: Stashr Location 1.7.0
Location ka naya version **kisi ko bhi apne aap offer nahi hota** (server par Location ka default "hold" hai). Isliye:
1. Naya APK GitHub par banta hai (release). Server use "update available" ke roop mein kisi phone ko nahi dikhata.
2. Apne **ek test phone** par APK haath se install karo: Apps page ka Location download link (ya release ka `stashr-where.apk`). Purane version (1.6.x) apni pehchaan nahi bhejte, isliye pehli baar haath se.
3. Phone par **Stashr Location → Room Lab**: kamre add karo, har kamre mein 4-5 jagah "Main yahan hoon" dabao. (Bluetooth ki permission ek baar poochi jaati hai; na do to sirf Wi-Fi se chalega.)
4. Website par **Start model** (ya tablet par).
5. Jab bharosa ho: **Settings → App updates** (`/app-updates`) mein Location ko "Sab ko" ya chune hue devices par kholo. Hub aur TV ke liye bhi wahin se.

Dhyan: training (step 3) ke bina model kuch nahi bata sakta. Wo ek baar karna hi padta hai; use skip karne ka koi tareeka nahi.

## Ghar ka layout edit karna (3D map)
- Web par House map > Edit: kamre ko drag karo (jagah), kone ke handle se size badlo, "height" se 3D unchai.
- Kamre jitne room list mein hain utne hi blocks bante hain; naya kamra khali jagah par aata hai, hataya hua kamra layout se bhi hat jaata hai.
- Save layout (`PUT /home/map/layout`), Auto-arrange (reset), Export/Import layout (JSON file).
- Tablet ko x, y, w, h wahi milte hain; height (z) tablet par abhi nahi dikhti (Hub ke naye release mein aayegi).

## Asli 3D model import (.glb)
- Web par House map > "3D model import karo (.glb)". Blender ya kisi bhi 3D tool se glTF Binary (.glb) export karo, 12 MB tak.
- Model ke hisse (mesh/group) ka naam kamre ke naam jaisa rakho: "Bedroom", "bedroom.001", "Bedroom_wall" sab Bedroom mein gine jaate hain. "Bedroom 2" alag kamra hai.
- Jis kamre mein koi hai wo hara jagta hai aur uske upar logon ke naam dikhte hain. Jis kamre ka model mein hissa nahi mila, uski list page par aati hai.
- "Sample .glb download": aapke abhi ke layout se kamron ke naam wale dibbe, jinhe Blender mein badal ke wapas import kar sakte ho.
- Server: `GET/PUT/DELETE /home/map/model` (har account ka ek model). Sirf website par; tablet par abhi nahi.
