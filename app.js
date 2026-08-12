import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

// ---------- state ----------
let currentUser = null;
let allMovies = [];      // raw docs from firestore
let currentView = "grid"; // grid | list
let searchTerm = "";
let pendingPhotos = [];   // {file, previewUrl} for the add/edit form (new uploads)
let existingPhotos = [];  // urls already saved (when editing)
let editingId = null;     // movie doc id being edited, null = new

// ---------- dom refs ----------
const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const appScreen = $("#app-screen");
const userChip = $("#user-chip");
const contentEl = $("#content");
const searchInput = $("#search-input");
const loadingOverlay = $("#loading-overlay");
const toastEl = $("#toast");

// ================= AUTH =================
$("#google-signin-btn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    showToast("登入失敗，請再試一次");
    console.error(e);
  }
});

$("#signout-btn").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    loginScreen.classList.add("hidden");
    appScreen.classList.add("active");
    renderUserChip();
    listenToMovies();
  } else {
    loginScreen.classList.remove("hidden");
    appScreen.classList.remove("active");
  }
});

function renderUserChip() {
  userChip.innerHTML = `
    <img src="${currentUser.photoURL || ''}" alt="">
    <button id="signout-btn2">登出</button>
  `;
  userChip.querySelector("#signout-btn2").addEventListener("click", () => signOut(auth));
}

// ================= FIRESTORE LISTENER =================
function listenToMovies() {
  const q = query(collection(db, "movies"), orderBy("watchDate", "desc"));
  onSnapshot(q, (snap) => {
    allMovies = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error(err);
    showToast("讀取資料失敗，請檢查 Firestore 設定");
  });
}

// ================= VIEW TOGGLE =================
$("#view-grid-btn").addEventListener("click", () => setView("grid"));
$("#view-list-btn").addEventListener("click", () => setView("list"));
function setView(v) {
  currentView = v;
  $("#view-grid-btn").classList.toggle("active", v === "grid");
  $("#view-list-btn").classList.toggle("active", v === "list");
  render();
}

// ================= SEARCH =================
searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

// ================= RENDER =================
function getFiltered() {
  if (!searchTerm) return allMovies;
  return allMovies.filter(m =>
    (m.title || "").toLowerCase().includes(searchTerm) ||
    (m.review || "").toLowerCase().includes(searchTerm)
  );
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, "0")}.${String(dt.getDate()).padStart(2, "0")}`;
}

function render() {
  const movies = getFiltered();

  if (movies.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <span class="emoji">🍿</span>
        <h3>${searchTerm ? "找不到這部電影" : "還沒有任何紀錄"}</h3>
        <p>${searchTerm ? "換個關鍵字試試看" : "點右下角的 ＋ 新增第一筆觀影紀錄"}</p>
      </div>`;
    return;
  }

  if (currentView === "grid") {
    contentEl.innerHTML = `<div class="grid-view">${movies.map(cardHtml).join("")}</div>`;
  } else {
    contentEl.innerHTML = `<div class="list-view">${movies.map(rowHtml).join("")}</div>`;
  }

  contentEl.querySelectorAll("[data-open-id]").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.openId));
  });
}

function cardHtml(m) {
  const cover = (m.photos && m.photos[0])
    ? `<img class="poster" src="${m.photos[0]}" loading="lazy" alt="${escapeHtml(m.title)}">`
    : `<div class="poster-fallback">🎬</div>`;
  return `
    <div class="ticket-card" data-open-id="${m.id}">
      ${cover}
      <div class="perf"></div>
      <div class="info">
        <div class="movie-title">${escapeHtml(m.title)}</div>
        <div class="movie-date mono">${formatDate(m.watchDate)}</div>
      </div>
    </div>`;
}

function rowHtml(m) {
  const thumb = (m.photos && m.photos[0])
    ? `<img class="thumb" src="${m.photos[0]}" loading="lazy" alt="">`
    : `<div class="thumb-fallback">🎬</div>`;
  return `
    <div class="list-row" data-open-id="${m.id}">
      ${thumb}
      <div class="meta">
        <div class="t">${escapeHtml(m.title)}</div>
        <div class="d mono">${formatDate(m.watchDate)}</div>
      </div>
      <div class="chev">›</div>
    </div>`;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ================= ADD / EDIT MODAL =================
const formModal = $("#form-modal");
const formTitle = $("#form-title-text");
const titleInput = $("#input-title");
const dateInput = $("#input-date");
const reviewInput = $("#input-review");
const photoRow = $("#photo-upload-row");
const fileInput = $("#file-input");
const deleteBtn = $("#delete-btn");

$("#fab-add").addEventListener("click", () => openForm());
$("#form-cancel-btn").addEventListener("click", closeForm);
$("#form-close-x").addEventListener("click", closeForm);

function openForm(movie = null) {
  editingId = movie ? movie.id : null;
  formTitle.textContent = movie ? "編輯紀錄" : "新增觀影紀錄";
  titleInput.value = movie ? movie.title : "";
  dateInput.value = movie ? movie.watchDate : new Date().toISOString().slice(0, 10);
  reviewInput.value = movie ? (movie.review || "") : "";
  existingPhotos = movie ? [...(movie.photos || [])] : [];
  pendingPhotos = [];
  deleteBtn.style.display = movie ? "block" : "none";
  renderPhotoRow();
  formModal.classList.add("active");
}
function closeForm() {
  formModal.classList.remove("active");
  pendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
  pendingPhotos = [];
}

function renderPhotoRow() {
  const existingHtml = existingPhotos.map((url, i) => `
    <div class="photo-thumb"><img src="${url}"><button class="rm" data-existing="${i}">✕</button></div>
  `).join("");
  const pendingHtml = pendingPhotos.map((p, i) => `
    <div class="photo-thumb"><img src="${p.previewUrl}"><button class="rm" data-pending="${i}">✕</button></div>
  `).join("");
  photoRow.innerHTML = existingHtml + pendingHtml + `<button type="button" class="add-photo-btn" id="add-photo-trigger">＋</button>`;

  $("#add-photo-trigger").addEventListener("click", () => fileInput.click());
  photoRow.querySelectorAll("[data-existing]").forEach(b => {
    b.addEventListener("click", () => {
      existingPhotos.splice(Number(b.dataset.existing), 1);
      renderPhotoRow();
    });
  });
  photoRow.querySelectorAll("[data-pending]").forEach(b => {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.pending);
      URL.revokeObjectURL(pendingPhotos[i].previewUrl);
      pendingPhotos.splice(i, 1);
      renderPhotoRow();
    });
  });
}

fileInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  files.forEach(file => {
    pendingPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
  });
  fileInput.value = "";
  renderPhotoRow();
});

// resize image client-side before upload (max edge 1400px) to keep storage light
function resizeImage(file, maxEdge = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxEdge || height > maxEdge) {
        if (width > height) { height = Math.round(height * maxEdge / width); width = maxEdge; }
        else { width = Math.round(width * maxEdge / height); height = maxEdge; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("#form-save-btn").addEventListener("click", async () => {
  const title = titleInput.value.trim();
  const watchDate = dateInput.value;
  const review = reviewInput.value.trim();

  if (!title) { showToast("請輸入電影名稱"); return; }
  if (!watchDate) { showToast("請選擇觀看日期"); return; }

  setLoading(true, "儲存中…");
  try {
    // upload new photos
    const uploadedUrls = [];
    for (const p of pendingPhotos) {
      const blob = await resizeImage(p.file);
      const path = `movies/${currentUser.uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(storageRef);
      uploadedUrls.push(url);
    }
    const photos = [...existingPhotos, ...uploadedUrls];

    if (editingId) {
      await updateDoc(doc(db, "movies", editingId), { title, watchDate, review, photos });
    } else {
      await addDoc(collection(db, "movies"), {
        title, watchDate, review, photos,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || "",
        createdByPhoto: currentUser.photoURL || "",
        createdAt: serverTimestamp()
      });
    }
    setLoading(false);
    closeForm();
    showToast("已儲存！");
  } catch (e) {
    console.error(e);
    setLoading(false);
    showToast("儲存失敗，請確認 Firebase 設定");
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("確定要刪除這筆觀影紀錄嗎？此動作無法復原。")) return;
  setLoading(true, "刪除中…");
  try {
    const movie = allMovies.find(m => m.id === editingId);
    if (movie && movie.photos) {
      for (const url of movie.photos) {
        try {
          const storagePath = decodeURIComponent(url.split("/o/")[1].split("?")[0]);
          await deleteObject(ref(storage, storagePath));
        } catch (err) { /* ignore individual delete failures */ }
      }
    }
    await deleteDoc(doc(db, "movies", editingId));
    setLoading(false);
    closeForm();
    closeDetail();
    showToast("已刪除");
  } catch (e) {
    console.error(e);
    setLoading(false);
    showToast("刪除失敗");
  }
});

// ================= DETAIL MODAL =================
const detailModal = $("#detail-modal");
$("#detail-close-x").addEventListener("click", closeDetail);

function openDetail(id) {
  const m = allMovies.find(x => x.id === id);
  if (!m) return;
  const isOwner = currentUser && m.createdBy === currentUser.uid;

  $("#detail-title-text").textContent = m.title;
  $("#detail-date").textContent = formatDate(m.watchDate);
  $("#detail-owner").innerHTML = m.createdByName
    ? `<img src="${m.createdByPhoto || ''}" alt=""> ${escapeHtml(m.createdByName)} 紀錄`
    : "";

  const photosHtml = (m.photos && m.photos.length)
    ? m.photos.map(u => `<img src="${u}" alt="">`).join("")
    : "";
  $("#detail-photos").innerHTML = photosHtml;
  $("#detail-photos").style.display = photosHtml ? "flex" : "none";

  const reviewEl = $("#detail-review");
  if (m.review) {
    reviewEl.textContent = m.review;
    reviewEl.classList.remove("empty");
  } else {
    reviewEl.textContent = "還沒有寫下心得。";
    reviewEl.classList.add("empty");
  }

  $("#detail-edit-btn").style.display = isOwner ? "block" : "none";
  $("#detail-edit-btn").onclick = () => { closeDetail(); openForm(m); };

  detailModal.classList.add("active");
}
function closeDetail() {
  detailModal.classList.remove("active");
}

// ================= UTIL =================
function setLoading(on, msg = "處理中…") {
  loadingOverlay.classList.toggle("active", on);
  $("#loading-text").textContent = msg;
}
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}
