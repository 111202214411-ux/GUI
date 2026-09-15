import streamlit as st
from ultralytics import YOLO
from PIL import Image

@st.cache_resource
def load_model():
    return YOLO("best.pt")  # model hasil training sendiri

st.title("Identifikasi Jenis Botol")
st.caption("Kelas: kaleng, kaca, plastik HDPE, plastik PET")

model = load_model()
conf = st.slider("Batas keyakinan", 0.1, 1.0, 0.25, 0.05)

file = st.file_uploader("Upload gambar", type=["jpg", "jpeg", "png"])
if file:
    img = Image.open(file).convert("RGB")
    hasil = model(img, conf=conf)[0]
    st.image(hasil.plot()[:, :, ::-1], caption="Hasil deteksi")
    if len(hasil.boxes) == 0:
        st.warning("Tidak ada botol terdeteksi.")
    for box in hasil.boxes:
        st.write(f"{model.names[int(box.cls)]}: {float(box.conf):.0%}")
