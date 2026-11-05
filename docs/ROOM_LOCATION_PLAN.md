# Kamre ki location (Room Location): poora plan

Maqsad: phone ya banda ghar ke **kaun se kamre mein hai** (Kitchen, Bedroom, Hall…), Wi-Fi aur Bluetooth ke patterns se, aur wo **khud behtar hota rahe**.
Ye **kamre tak** ki pehchan hai, meter tak ki exact location nahi. Neeche jo accuracy ke aankde hain wo **target** hain, vaade nahi: asli ghar par napna padega.

## 0. Pehle ye maan lete hain (sach)
- Ek router ke saath bhi Wi-Fi fingerprint kaam kar sakta hai, kyunki ghar mein padosiyon ke routers, hotspots aur Bluetooth devices bhi dikhte hain. Kitna kaam karega ye ghar par depend karta hai.
- Android Wi-Fi scan ko dheema karta hai (mere hisaab se app foreground mein ho to kuch scan har 2 minute mein, background mein bahut kam). Tez scan ke liye notification wali foreground service chahiye.
- Bluetooth: phones, earbuds aur kai devices apna address **badalte rehte hain** (random MAC), isliye wo pakke anchor nahi hote. Pakke anchor: TV, speaker, smart bulb, fixed beacons, aur wo purane phones jo beacon banaye jaayein.
- Koi bhi wireless tareeka 100% nahi hota. Isliye plan mein "pata nahi" bolna, confidence, aur doosre sanket shaamil hain.

## 1. Phase 1: Room Lab (data jama karne wala app) — aapka idea
Location app ke andar ek chhupa hua **Room Lab** screen, taaki permissions, link aur server pehle se wahi rahein.
- Kamron ki list (Kitchen, Bedroom, Hall…). Har kamre mein 4-5 jagah jaake "Main yahan hoon: <kamra>" dabao.
- Har tap par app ~10 second tak ye record karta hai:
  - **Wi-Fi scan:** har dikhte network ka BSSID, signal (RSSI), frequency (SSID ka naam hash karke, padosi ka naam nahi rakhna).
  - **Bluetooth (BLE) scan:** har dikhte device ka (badalta) address, naam agar ho, signal, service ID, aur manufacturer data.
  - **Jude hue Bluetooth devices:** agar phone kisi speaker, watch ya car se juda hai, to wo bhi (kamre ka suraag).
  - **Phone ke sensors (optional):** magnetometer (deewar aur loha kamre ke hisaab se alag asar dete hain), barometer (manzil ka pata).
- Data server par jaata hai, aur **CSV mein export** bhi hota hai, taaki aap ya main alag se jaanch sakein.
- Aapka kaam: 8-10 kamre x 4-5 jagah x 5 scan, aur 2-3 alag din (subah, shaam, raat) ka data. Ek alag din ka data **test** ke liye alag rakhna hai.

## 2. Phase 2: jaancho kya kaam karta hai (data se, andaze se nahi)
- Server par ek analysis script: weighted k-nearest-neighbour (ya simple classifier) Wi-Fi vectors par.
- **Cross-validation** aur "alag din" wali jaanch: kitne % sahi, aur kaun se kamre aapas mein confuse hote hain (confusion matrix).
- Tulna: sirf Wi-Fi, Wi-Fi + Bluetooth, Wi-Fi + Bluetooth + magnetometer. **Jo sach mein behtar ho wahi rakho.**
- Phone ke andar bhi ye report dikhe ("Bedroom 90%, Kitchen/Hall mein 25% galti"), taaki aap bina mere dekhe sudhar sako.
- **Gate:** target kamre-ke-hisaab se ~85% ya zyada, aur galat kamra badalne ki dar kam. Isse kam ho to Phase 5 (hardware) pe jaao, aage mat badho.

## 3. Phase 3: asli kaam (structure)
```
Phone: scan  ──ghar ke Wi-Fi par──▶  Hub tablet: kamra pehchane  ──▶  Server: backup, map, Telegram
```
- **Training** server par surakshit, **har phone ka alag** (har phone ka radio alag naapta hai). Hub use download karke rakhta hai.
- Hub kamra nikalta hai; server band ho to bhi ghar ke andar chalta hai. Tablet band ho to phone seedha server ko bhej sakta hai.
- **Smoothing:** ek scan par kamra mat badlo; 2-3 lagaatar scan agree karein tabhi. Kamre ke beech ka raasta map se pata hota hai.
- **Confidence:** kam bharosa ho to "Hall ya Kitchen (60%)" ya "pata nahi", galat pakka jawab nahi.
- Faisla: foreground service (tez, par notification hamesha) ya dheema scan. **Aap tay karoge.**

## 4. Phase 4: map aur baaki Stashr mein
- Ghar ke map par (jo pehle se hai) log sahi kamre mein dikhein. Plan image par kamre draw karne ka option.
- Telegram: "Papa abhi Bedroom mein hain", sawaal-jawaab mein kamra, aadat seekhne mein kamra ("Papa roz 7 baje Kitchen mein").
- Health tab: har phone ke liye kamre ki accuracy, aakhri scan, kab train hua.

## 5. Phase 5: khud behtar hona (auto improve)
- "Galat hai, main Hall mein hoon" button: wo scan sahi label ke saath naya sample ban jaata hai.
- Jab confidence kam ho to kabhi-kabhi "kya aap Bedroom mein ho?" poochna (zyada nahi, taaki pareshan na kare).
- Jab bharosa zyada ho **aur** doosra sanket mile (tablet ke paas Bluetooth, raat ko charge), to khud naya sample judta hai.
- Furniture ya router hilne se pattern badalta hai: **purane samples ka asar dheere kam** hota hai.
- Roz ek check: accuracy giri to Telegram par batao "Bedroom ki pehchan kamzor hui, dobara train karo".

## 6. Phase 6: hardware booster (zarurat padne par)
- **Purane Android phones ya tablets ko Bluetooth beacon** banao (har kamre mein ek): sabse aasan aur bharosemand upaay.
- Tablet khud ek beacon: "tablet ke paas hai ya nahi" pakki cheez hai.
- Ek purana router doosre kamre mein (access-point mode): ek se do Wi-Fi zone.
- ESP32 boards (~₹400 ek) beacon ya CSI sensing ke liye (jo bina phone wale insaan ke liye bhi kuch kaam karta hai). Alag aur badi planning.

## 7. Privacy aur safety
- Sirf unke phones jo **khud** kehte hain (opt-in), aur har banda apni kamre ki location ko **band** kar sake.
- Kachche scan 30 din se zyada nahi, aur padosi ke Wi-Fi ke naam kabhi nahi rakhte (hash).
- Kamre ki location sirf aapke Stashr account, website, tablet aur Telegram mein dikhti hai. Kisi aur ko nahi.
- Zaroori faislon (jaise dawai ka reminder) mein sirf kamre par bharosa nahi: phone aur tablet dono bolein.

## 8. Kaise napenge (success)
| Napa | Target (andaaza, vaada nahi) |
|---|---|
| Kamre ki sahi pehchan (alag din ka data) | 85%+ |
| Kamra badalne ke baad update ka samay | 30 second se 2 minute (Android ki hadon ke andar) |
| Galat kamra badalna (ghante mein) | kam se kam |
| Battery | tay karo: din mein kitna % tak theek hai |
| "pata nahi" ka hissa | itna kam ki kaam ka rahe |

## 9. Kaam ka kram aur kaun kya karega
1. **Main banaunga:** Room Lab (Location app), server par samples aur export, analysis script, validation report.
2. **Aap karoge:** testing phone par data jama karna (ghar mein chalna), aur report ke aankde bata dena. Main aapke phone ya ghar tak nahi pahunch sakta.
3. Report ke baad tay hoga kaun si cheezein (Wi-Fi/Bluetooth/magnetometer) rakhni hain.
4. Phir Phase 3, 4, 5 banenge. Phase 6 sirf zarurat par.

## 10. Jo aapko tay karna hai
- Foreground service (notification, tez) ya dheema scan.
- Kamron ki list.
- Purane phones ya tablets beacon ke liye hain ya nahi.
- Kaun-kaun se log opt-in karenge.
