# Location tracking, Telegram aur battery: kya badla aur kaise test karein

Yeh note tracking / Telegram / battery wale session ka hai (2026-11-05). Test ke steps neeche hain.

## Kya upgrade hua (simple Hinglish mein)

### 1. "Ghar par hain" ab sach bolta hai (/who, /coming, website)
- Pehle: koi ghar se nikal jaye to bhi Wi-Fi ki purani report ki wajah se 15 se 30 minute tak "ghar par" dikhta tha, aur `/coming` "sab ghar par hain" jaisa bol deta tha.
- Ab: **Wi-Fi aur location dono** milkar tay karte hain.
  - Phone ka taza location (12 minute se purana nahi) ghar ke circle ke andar hai to ghar par; bahar hai to bahar, chahe laptop jaisa koi device ghar ke Wi-Fi par ho.
  - Phone ghar ke Wi-Fi par khud dikh raha ho to ghar par (jab tak location 2 km se door na ho).
  - Location purani ho aur Wi-Fi bhi na dikhe to "location update nahi hua" likhta hai, "sab ghar par hain" nahi.
- `/who`: "Out: Papa (6 km away, updated 3 min ago)". `/coming`: "Papa bahar hain, 6 km door (3 min pehle update)" ya "Papa 11 minute mein aa rahe hain".

### 2. Saath chalne wale phone ek gine jate hain
- Do phone 250 m ke andar saath hon (aur dono ghar se bahar) to sirf **major phone** (jo pehle link hua) ka update aata hai: "Papa (with Mom) is arriving in 10 mins".
- 400 m se door hote hi dono ke alag updates. Agar major phone ka location purana ho to dusre phone ko jodta nahi.
- Ghar pahunchne par bhi ek hi "Open the door: Papa (with Mom) arrived home".

### 3. Battery ke hisaab se sync
- Phone charging mein ya 60% se upar: jaldi poochta hai (ghar par ~6 minute, bahar ~6 minute).
- 40-60%: normal. 20-40%: dheere. 20% ya kam (charging nahi): bahut dheere.
- **20% ya kam par**: phone ek baar aakhri sahi location turant bhej deta hai. Server sab ko batata hai (TV, tablet, doosre phone, Telegram): "Papa's phone battery is 19%. Location may stop soon. Last location: 4.1 km from home, just now."
- Phone 45 minute chup rahe aur battery <= 20% ho to: "Papa's location stopped (battery 18%). Last seen ... " (har 6 ghante mein ek baar).
- Website par aisa phone "Location stopped (battery low) - last seen 4 km from home, 50 min ago" dikhata hai.

### 4. Ghar chhodna / pahunchna turant pakadna
- Phone ab Wi-Fi jude/hate to khud turant naya location bhejta hai (battery low ho to nahi). Isse "ghar se nikla" 20-30 minute baad nahi, kuch second mein pata chalta hai.

### 5. Refresh / Sync location
- Website: Smart home -> Devices -> Family locations -> **"Refresh location"** button. Telegram: **/locate**.
- 90 second tak har phone har 8 second mein location bhejta hai. Website har 4 second mein check karti hai aur "Locations are fresh" dikhati hai.
- Phone ko ye tab pata chalta hai jab woh server se agli baar poochta hai (high battery par 5-6 minute se zyada nahi).

### 6. Time wale place par tez polling (office / ghar WhatsApp message)
- Agar place par arrive/leave ka time set hai, to us time se 5 minute pehle se time khatam hone tak, aur phone place se 2 km ke andar ho to phone **har 30 second** mein real location bhejta hai, taaki WhatsApp message mein deri na ho.
- Time ke baahar place ke paas har 5 minute (bina time wale place par har 3 minute). Battery 20% ya kam ho to ye tez polling band.

### 7. Telegram
- Har command par "typing..." dikhta hai. 2 second se zyada lage to "Working on it..." message aata hai jo jawab aate hi usi message mein badal jata hai. Galti ho to saaf message: "That did not work...". Koi command chup nahi rehta.
- Shortcuts sort kiye: Home mein `/who`, `/coming`, `/locate`, `/today`, `/phones`, `/devices`... Naye: **/locate** (location refresh), **/screenoff** (tablet screen band, confirmation ke saath).
- `/devices` mein tablet ke camera ki halat dikhti hai (watching / off / error).
- /help ya /menu dabane par commands ki list Telegram mein dobara refresh hoti hai.

### 8. Tablet ki screen band karna
- Website: tablet ke card mein **"Turn screen off"**. Telegram: **/screenoff**. Hub Accessibility ke "lock screen" se screen band karta hai.

### 9. Camera ki health
- Tablet ke camera ka error (jaise "Allow the camera for Stashr Hub") ab website ke Security camera card mein laal likha dikhta hai, aur Telegram `/devices` mein bhi.

## Kal kaise test karein (checklist)

Pehle: Location app (phone) aur Hub (tablet) naye build par update ho jayein. Android apps GitHub release ke baad server se khud update lete hain; ya `scripts/install-home-devices.sh --phone usb` / `--tablet usb` chalao.

1. **Ghar se nikalna**: phone ka Wi-Fi band karo ya ghar se bahar jao. Dekho: 1-2 minute mein Telegram `/who` mein "Out: <naam> (… km away, … min ago)" aaye, aur `/coming` "bahar hain" bole, "Sab ghar par hain" nahi.
2. **Refresh**: website par "Refresh location" dabao. Dekho: 1-5 minute mein "Locations are fresh". Telegram par `/locate` bhejo: "Asking the family phones..." jawab aaye.
3. **Saath chalna**: do phone saath leke ghar ki taraf aao. Dekho: ETA sirf ek hi naam se aaye ("Papa (with Mom) is arriving in N mins"). Ek phone door karo (400 m+): dusre ko alag update mile.
4. **Battery 20%**: phone ko 20% tak le jao (ya charging hata ke 19% par). Dekho: sab ko "battery is 19%" ka message ek baar. Phone band/airplane mode karke 45 minute ruko: "location stopped" ka message.
5. **Time wala place**: Office place par arrive ka time set karo (abhi se 10 minute baad). Phone ko office ke 2 km ke andar rakho. Dekho: time se pehle se location har ~30 second mein badal rahi ho (website ya `/who`), aur office pahunchte hi WhatsApp message turant jaye.
6. **Telegram typing**: koi bhi command bhejo (jaise `/status`). Dekho: "typing..." nishan; dheere command par "Working on it..." jo jawab mein badal jaye.
7. **Screen off**: website par tablet ke card mein "Turn screen off" dabao, ya Telegram `/screenoff` bhejke Confirm dabao. Tablet ki screen sleep ho jani chahiye (Hub ki Accessibility on honi chahiye).
8. **Camera error**: tablet ka camera permission band karo, website ke Security camera card mein laal error aana chahiye.

## Jo abhi pakka nahi / known gaps

- Phone ko "abhi location bhejo" kehne ke liye push notification (FCM) nahi hai. Refresh ka asar phone ke agle check par hi dikhta hai (charged phone par kuch minute).
- Phone ke 30 second ke check WorkManager se chalte hain; Android Doze mein thodi der late kar sakta hai.
- `tests/homeMore.test.js` ka ek purana test ("arriving at a place inside the time window...") sirf raat 00:00-01:00 (IST) ke beech fail hota hai, kyunki woh abhi ke time par depend karta hai. Yeh mere badlav se nahi hai.
- Phone-app ke naye hisse (Wi-Fi trigger, 20% par aakhri location) ka logic unit test hua hai, par asli phone par chalke maine nahi dekha.
- Tablet ka "screen off" asli tablet par maine test nahi kiya (Accessibility chahiye, Android 9+).
- Telegram ka typing nishan asli bot par dekhna baaki hai; tests mein sirf API calls check hui hain.
