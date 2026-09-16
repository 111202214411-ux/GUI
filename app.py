import io
from collections import Counter

import pandas as pd
import streamlit as st
from PIL import Image
from ultralytics import YOLO

st.set_page_config(page_title="Identifikasi Jenis Botol", page_icon="♻️", layout="centered")

# Nama tampilan dan saran pemilahan untuk tiap kelas
INFO = {
    "kaca": ("Botol kaca", "Pisahkan sebagai sampah kaca, hati-hati jika pecah."),
    "plastik": ("Botol plastik", "Kosongkan, remas, lalu masukkan ke sampah plastik/daur ulang."),
}


@st.cache_resource
def load_model():
    return YOLO("best.pt")


model = load_model()

# ---------- Sidebar ----------
with st.sidebar:
    st.header("Pengaturan")
    conf = st.slider("Batas keyakinan", 0.01, 1.0, 0.25, 0.01)
    st.caption("Nilai rendah: lebih banyak deteksi. Nilai tinggi: hanya deteksi yang yakin.")
    st.divider()
    st.subheader("Tentang aplikasi")
    st.write("Algoritma: YOLOv8n")
    st.write("Kelas: " + ", ".join(INFO.get(n, (n,))[0] for n in model.names.values()))
    st.write("Dataset: Drinking Waste Classification (Kaggle)")

# ---------- Halaman utama ----------
st.title("♻️ Identifikasi Jenis Botol")
st.caption("Deteksi bahan botol (kaca atau plastik) untuk membantu pemilahan sampah.")

tab_upload, tab_kamera = st.tabs(["📁 Upload gambar", "📷 Kamera"])
with tab_upload:
    file_upload = st.file_uploader("Pilih gambar", type=["jpg", "jpeg", "png"])
with tab_kamera:
    file_kamera = st.camera_input("Ambil foto")

file = file_upload or file_kamera
if file is None:
    st.info("Upload gambar atau ambil foto untuk memulai.")
    st.stop()

img = Image.open(file).convert("RGB")
with st.spinner("Mendeteksi..."):
    hasil = model(img, conf=conf, agnostic_nms=True)[0]
gambar_hasil = Image.fromarray(hasil.plot()[:, :, ::-1])

kiri, kanan = st.columns(2)
kiri.image(img, caption="Gambar asli")
kanan.image(gambar_hasil, caption="Hasil deteksi")

if len(hasil.boxes) == 0:
    st.warning("Tidak ada botol terdeteksi. Coba turunkan batas keyakinan di sidebar.")
    st.stop()

# Tabel hasil
data = []
for box in hasil.boxes:
    kelas = model.names[int(box.cls)]
    nama, saran = INFO.get(kelas, (kelas, "-"))
    data.append({"Jenis": nama, "Keyakinan": f"{float(box.conf):.0%}", "Saran pemilahan": saran})

st.subheader(f"Terdeteksi {len(data)} benda")
jumlah =
