# 🎬 片刻 Movie Diary

手機版的觀影紀錄網站。海報牆＋總覽清單、搜尋、Google 登入、照片上傳（海報／票根），資料透過 Firebase 同步，任何用 Google 登入的人都能看到共同的紀錄（共享日記的概念，例如你和另一半、或朋友一起紀錄）。

---

## 一、建立 Firebase 專案（約 10 分鐘）

1. 前往 [Firebase Console](https://console.firebase.google.com/) → 「新增專案」，取個名字（例如 `movie-diary`）。
2. **啟用登入方式**：左側選單 → Build → Authentication → 「開始使用」→ Sign-in method → 啟用 **Google**。
3. **建立資料庫**：左側選單 → Build → Firestore Database → 「建立資料庫」→ 選「以正式版模式啟動」（等下會貼規則）→ 選離你最近的地區（例如 `asia-east1`）。
4. **啟用 Storage**（放照片用）：左側選單 → Build → Storage → 「開始使用」→ 一樣選正式版模式、同一個地區。
5. **取得設定值**：左側選單 → 專案設定（齒輪）→ 一般 → 頁面最下方「你的應用程式」→ 點 `</>` 新增網頁應用程式 → 取個名字 → 會出現一段 `firebaseConfig`。

把這段設定值貼到專案的 `js/firebase-config.js`，取代裡面的 `YOUR_...` 佔位字串。

---

## 二、設定安全規則

### Firestore 規則
Firestore Database → 規則，貼上：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /movies/{movieId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.createdBy == request.auth.uid;
      allow update, delete: if request.auth != null
                    && resource.data.createdBy == request.auth.uid;
    }
  }
}
```

這代表：**任何登入的使用者都能看到全部的紀錄（共享）**，但只有本人能修改／刪除自己新增的那一筆。

### Storage 規則
Storage → 規則，貼上：

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /movies/{uid}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

> 如果你只想要「自己一個人用」而不共享，把 `allow read` 改成 `resource.data.createdBy == request.auth.uid`（Firestore）／`request.auth.uid == uid`（Storage）即可。

### 授權網域（很重要）
Authentication → Settings → Authorized domains → 把你之後的 GitHub Pages 網址加進去，例如：
`你的帳號.github.io`

---

## 三、放到 GitHub Pages

1. 在 GitHub 建立一個新的 repository（例如 `movie-diary`）。
2. 把這整個資料夾（`index.html`、`css/`、`js/`、`assets/`）上傳 / push 上去：
   ```bash
   cd movie-diary
   git init
   git add .
   git commit -m "movie diary app"
   git branch -M main
   git remote add origin https://github.com/你的帳號/movie-diary.git
   git push -u origin main
   ```
3. GitHub repo → Settings → Pages → Source 選 `main` branch、`/ (root)` → Save。
4. 等 1–2 分鐘，網址會是：`https://你的帳號.github.io/movie-diary/`
5. 把這個網址加進上面第二步「授權網域」裡（只要填 `你的帳號.github.io` 就好，不用完整路徑）。

用手機打開這個網址，也可以「加到主畫面」變成類 App 的圖示。

---

## 功能總覽

- **Google 登入 / 登出**，資料即時同步（Firestore `onSnapshot`）
- **新增紀錄**：電影名稱、觀看日期、多張照片（海報、票根皆可，上傳前自動壓縮）、心得文字
- **海報牆（Grid）**：手機一排 2 張、平板以上 3 張，每張卡片用第一張照片當封面
- **總覽（List）**：日期＋片名的直向清單，方便快速瀏覽
- **搜尋**：即時比對片名與心得內容
- **詳細頁**：點卡片看完整照片、心得，本人可編輯／刪除
- **共享**：所有登入者共用同一份紀錄（可依上方規則調整成僅個人）

## 檔案結構

```
movie-diary/
├─ index.html
├─ css/style.css
├─ js/
│  ├─ firebase-config.js   ← 填入你的 Firebase 設定
│  └─ app.js
├─ assets/hero-bg.png       ← 登入畫面背景圖
└─ README.md
```

## 之後想加強的話

- 上傳票根時可加 OCR 自動辨識電影名稱／日期
- 依年份分類、統計「今年看了幾部電影」
- 支援評分（星等）
- 邀請制共享（只讓特定 email 加入，而不是所有 Google 帳號）
