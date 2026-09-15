import streamlit as st
from ultralytics import YOLO
from PIL import Image

@st.cache_resource
def load_model():
    return YOLO("yolov8n.pt")  # model bawaan, sudah mengenal 'bottle'

st.title("Identifikasi Benda")
model = load_model()

file = st.file_uploader("Upload gambar", type=["jpg", "jpeg", "png"])
if file:
    img = Image.open(file)
    hasil = model(img)[0]
    st.image(hasil.plot()[:, :, ::-1], caption="Hasil deteksi")
    for box in hasil.boxes:
        st.write(f"{model.names[int(box.cls)]}: {float(box.conf):.0%}")