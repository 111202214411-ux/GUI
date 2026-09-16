import io

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
    daftar_kelas = [INFO.get(n, (n, "-"))[0] for n in model.names.values()]
    st.write("Kelas: " + ", ".join(daftar_kelas))
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
jumlah = {}
for box in hasil.boxes:
    kelas = model.names[int(box.cls)]
    nama, saran = INFO.get(kelas, (kelas, "-"))
    keyakinan = float(box.conf)
    data.append({"Jenis": nama, "Keyakinan": f"{keyakinan:.0%}", "Saran pemilahan": saran})
    jumlah[nama] = jumlah.get(nama, 0) + 1

st.subheader(f"Terdeteksi {len(data)} benda")
kolom_list = st.columns(len(jumlah))
for kolom, jenis in zip(kolom_list, jumlah):
    kolom.metric(jenis, jumlah[jenis])

st.table(pd.DataFrame(data))

# Tombol unduh
buf = io.BytesIO()
gambar_hasil.save(buf, format="PNG")
st.download_button("⬇️ Unduh hasil deteksi", buf.getvalue(), "hasil_deteksi.png", "image/png")
