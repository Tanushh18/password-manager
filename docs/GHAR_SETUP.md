# Ghar jaakar kya karna hai (sirf ye file padho)

Ye file ek hi baar ka setup hai. Isko upar se neeche tak karo. Ho jaane ke baad sab apne aap chalta hai.
Time: lagbhag 45 minute. Kuch bhi galat lage to aakhir mein "Agar kuch na chale" dekho.

## Ghar jaane se pehle (kahin se bhi, 5 minute)
- [ ] GitHub par dekho ki 4 APK ban chuke hain (Releases): `stashr-hub-v…`, `stashr-where-v…`, `stashr-tv-v…`. (Ho chuke hain.)
- [ ] Dono Render servers (g305 aur xxdr) par naya deploy "Live" hai. Dono mein `MAPBOX_TOKEN` daala hai (live traffic ke liye).
- [ ] Stashr website kholo: **Settings → Telegram** mein bot jura hai (nahi to alerts Telegram par nahi aayenge, sirf website par).
- [ ] (Chahiye to) Photo Cloud mein Google account jura hai (movies aur photo frame ke liye Drive chahiye).

## Shortcut: ek command se tablet aur TV (computer se)
Computer, tablet aur TV ek Wi-Fi par. Dono par Developer options → USB debugging (aur Network/Wireless debugging) on. Phir repo ke andar:
```bash
scripts/install-home-devices.sh --tablet <TABLET-IP> --tv <TV-IP>
```
Ye GitHub se sabse naye Hub aur TV APK utarta hai, `adb install` karta hai, aur jo permissions adb de sakta hai wo deta hai (camera, mic,
notifications, "Display over other apps", battery, TV ka accessibility, Stashr TV ko home app). Family phones ke liye `--phone-apk` APK
download kar deta hai. Uske baad bas Step 2.2/2.3 aur 4.4 ke codes tablet/TV par daalne hain. Baaki neeche ke steps tab dekho jab script kuch
na kar paye.

## Step 1 · Website par ghar ki location (2 minute) — ghar par khade hokar
1. Phone se Stashr website kholo: **Smart home → Automations → Places → Home location**.
2. "Use this device's location" dabao → **Save home**. (Sirf ek baar; saare phones ke liye wahi chalti hai.)
3. **Smart home → Camera & alerts → Alerts and daily briefs**:
   - City likho (weather ke liye) → Save.
   - Morning brief **on** karo (time chuno, jaise 08:00).
   - "Remind someone to take an umbrella…" **on**.
   - "Morning headlines on the TV" **on**, bhasha chuno.
   - "Someone comes home or leaves" **on**.
4. **Smart home → Camera & alerts → Security camera**: "Turn on by itself when everyone is out…" **tick** karo.

## Step 2 · Tablet (10 minute) — ye ghar ka dimaag hai, hamesha charging par rakho
1. Tablet ke browser mein Stashr website → **/apps** → **Download Stashr Hub** → install (jab pooche "unknown apps" allow karo).
2. Website par: **Smart home → Devices → Link the home tablet or TV** → code dikhega (**Copy**).
3. Tablet par Stashr Hub kholo → wo code + naam (jaise "Hall tablet") → **Join**.
4. Jo permissions maange sab **Allow** karo: Camera, Microphone, Notifications.
5. Settings kholne par jo pooche: **Display over other apps → Allow** (announcements ke liye), **Battery optimisation → Allow/Unrestricted**.
6. **WhatsApp wala (agar chahiye)**: Hub ke dashboard par "WhatsApp messages" card → Accessibility kholo → Stashr Hub **on** karo. (Android 13+: App info → ⋮ → *Allow restricted settings* pehle.) Tablet par WhatsApp login ho aur screen lock **None/Swipe** ho.
7. Tablet ko ghar mein aisi jagah rakho jahan se darwaza/kamra dikhe (camera ke liye), aur charging par.

Website par Devices tab mein tablet **online** dikhna chahiye (1 minute mein).

## Step 3 · Family ke phones (har phone par 5 minute)
1. Phone par **/apps → Download Stashr Location** → install.
2. Website: **Smart home → Devices → Family locations** → code (**Copy**) bhejo us bande ko (ya khud daalo).
3. App mein: code + **us bande ka poora naam** (jaise "Parveen Chawla") → **Connect**.
4. Location permission: pehle "Allow", phir **"Allow all the time"** (zaroori, warna ghar aane par pata nahi chalega).
5. Notifications permission **Allow**.
6. Xiaomi/Oppo/Vivo/Samsung phone ho to app ke andar "If updates stop…" wale button se battery settings mein is app ko **Unrestricted** karo.
7. Website par us bande ka naam list mein aa jana chahiye ("Waiting for the first location" → phir doori dikhegi).

## Step 4 · TV (15 minute)
1. TV par Developer options on karo: **Settings → Device Preferences → About → "Build" 7 baar dabao**, phir **Developer options → USB debugging** (aur ho sake to *Network debugging*) on.
2. Computer aur TV ek Wi-Fi par. Computer ke terminal mein (TV ka IP TV ki Wi-Fi settings mein dekho):
   ```bash
   adb connect <TV-ka-IP>:5555
   ```
   TV par "Allow USB debugging" → Always allow.
3. Release APK computer par download karo (website `/apps` → *Download Stashr TV*; ya GitHub Releases se `stashr-tv.apk`), phir:
   ```bash
   adb install -r stashr-tv.apk
   ```
   (Debug APK mat daalna; uske baad OTA update install nahi hoga.)
4. TV par Stashr TV kholo → wahi **home-device code** (Step 2.2 wala) + naam (jaise "Living room TV") → Join.
5. Jab Android pooche "Home app?" → **Stashr TV** → Always.
6. Stashr TV ki Settings: **"Stashr TV remote" accessibility → on**, **Display over other apps → Allow**.
7. Movies chahiye to USB drive TV mein lagao (Step 5).

## Step 5 · Movies aur photo frame (agar chahiye)
- Website: **Smart home → Media & network → Movies from Google Drive** → Google account chuno → Drive folder chuno. Folder mein movie daalte hi TV ke USB mein apne aap aa jati hai.
- **Photo frame**: usi tab mein Drive photo folder chuno. Tablet 10 minute khali rahe to slideshow chalta hai.

## Step 6 · 10 minute ka check (pakka karne ke liye)
- [ ] Website → Smart home → **Overview → What is switched on**: sab "On" dikhe (tablet, family phones, location, camera, alerts…).
- [ ] **Overview → Home screen** card: weather, log, TV dikh rahe hain.
- [ ] Camera: Camera & alerts → **Start security camera** → tablet ke saamne se guzro → photo Telegram par aaye. Phir **Stop**.
- [ ] Announce test: Telegram par likho **"today updates"** → tablet par list khule.
- [ ] Phone ko ghar se ~2 km door le jao aur wapas aao: website par "heading home" aur minute dikhe; tablet par "… minute mein aa rahe hain"; ghar pahunchne par "Open the door: … arrived home".
- [ ] TV par kuch chalate hue website se **volume up**, **pause** try karo.
- [ ] Agar sab theek: bas. Ab kuch nahi karna.

## Roz apne aap kya hota hai (tumhe kuch nahi karna)
- Ghar se sab nikle → 2 minute baad camera on; koi aaya → camera off.
- Koi aa raha ho → tablet par card, TV par message, doosre phones par notification, Telegram par message ("X is arriving in 15 mins", phir 5 min par, phir "Open the door: X arrived home").
- Nikalte waqt barish ho sakti ho → sirf us bande ke phone par "Chhatri le lo".
- Subah pehli baar TV home par aaye → Good morning panel (weather + khabrein). Roz subah Telegram par brief.
- Weekend shaam sab ghar par → TV par "Aaj movie night?".
- Naya anjaan device Wi-Fi par → Telegram alert; raat ko alag alert.
- Movie Drive mein daalo → TV mein download. Naya app version aaye → TV/tablet/phone par ek tap se update.
- Roz internet speed ka record; Sunday ko weekly report.

## Ye nahi hoga (pehle hi jaan lo)
- TV ko band karna (app power-off nahi kar sakta; sirf pause/home).
- Light, pankha, curtain: iske liye hardware chahiye.
- Tablet kuch bolega nahi: sab sirf screen par.
- Doosre ke phone ke messages/photos nahi dikhte; Location app sirf location, battery, Wi-Fi bhejta hai.
- ETA kuch minute aage-peeche ho sakti hai; live traffic Mapbox token se aata hai.

## Agar kuch na chale
| Dikkat | Kya karo |
|---|---|
| Tablet/TV website par "offline" | Wi-Fi/internet dekho; app ek baar kholo; battery optimisation band karo; server so raha ho to 1 minute ruko |
| Phone ki location nahi aati | Location "Allow all the time"; GPS on; battery saver ka Unrestricted; app kholkar "Update my location now" |
| ETA "unset" / doori nahi | Step 1 ka Home location save hai? |
| "live traffic" nahi dikhta | `MAPBOX_TOKEN` (pk. wala) dono servers mein? deploy hua? |
| Announcement tablet par nahi khula | "Display over other apps" allow; tablet online; warna sirf notification aati hai |
| TV par message nahi dikha | Stashr TV Settings mein overlay permission; TV chal raha ho |
| TV Home/Back kaam nahi karta | "Stashr TV remote" accessibility on |
| WhatsApp message nahi gaya | Accessibility on, tablet lock None, group ka naam bilkul WhatsApp jaisa, "Send test" |
| Kuch aur | `docs/TABLET_TEST_PLAN.md` ke "Found" mein likho: kya kiya, kya hua, `adb logcat` ki lines — aur mujhe bhejo |

Detail aur har feature ka poora test: `docs/TABLET_TEST_PLAN.md`. Har app ka description: `docs/APPS.md`. Sab features: `docs/SMART_HOME.md`.
