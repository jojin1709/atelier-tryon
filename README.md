<div align="center">

<img src="logo.png" alt="Atelier AI Logo" width="140" style="border-radius: 28px; box-shadow: 0 16px 40px rgba(0,0,0,0.6);">

# Atelier AI

### Universal Virtual Try-On Studio — Powered by Decart Lucy VTON 3.5 & On-Device AI

**A high-performance, privacy-first virtual fitting room** that works seamlessly across **Web (Vercel)**, **Local Machines (GPU/CPU)**, and as a **Manifest V3 Chrome Extension** on any e-commerce fashion storefront.

**Engineered with real-time composite rendering**, hardware acceleration, signed Decart JWT client tokens, and transparent webcam mirror tracking.

<br/>

[![License](https://img.shields.io/github/license/jojin1709/atelier-tryon?style=flat-square&labelColor=0D1117&color=6366F1)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-0D1117?style=flat-square&labelColor=0D1117&logo=python&logoColor=6366F1)](https://www.python.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-MV3-0D1117?style=flat-square&labelColor=0D1117&logo=googlechrome&logoColor=38BDF8)](https://developer.chrome.com/docs/extensions/mv3/)
[![Decart AI](https://img.shields.io/badge/Decart_AI-Lucy_VTON_3.5-0D1117?style=flat-square&labelColor=0D1117&logo=openai&logoColor=38BDF8)](https://platform.decart.ai/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-0D1117?style=flat-square&labelColor=0D1117&logo=vercel&logoColor=white)](https://vercel.com/)
[![Stars](https://img.shields.io/github/stars/jojin1709/atelier-tryon?style=flat-square&labelColor=0D1117&color=6366F1)](https://github.com/jojin1709/atelier-tryon/stargazers)
[![Forks](https://img.shields.io/github/forks/jojin1709/atelier-tryon?style=flat-square&labelColor=0D1117&color=6366F1)](https://github.com/jojin1709/atelier-tryon/network/members)
[![Issues](https://img.shields.io/github/issues/jojin1709/atelier-tryon?style=flat-square&labelColor=0D1117&color=6366F1)](https://github.com/jojin1709/atelier-tryon/issues)

<br/>

![](https://img.shields.io/badge/Real_Time_Mirror-6366F1?style=for-the-badge&labelColor=0D1117)
&nbsp;![](https://img.shields.io/badge/Decart_Cloud_%2B_Local_GPU-6366F1?style=for-the-badge&labelColor=0D1117)
&nbsp;![](https://img.shields.io/badge/Zero_Video_Upload_Privacy-6366F1?style=for-the-badge&labelColor=0D1117)
&nbsp;![](https://img.shields.io/badge/Chrome_Store_Ready-38BDF8?style=for-the-badge&labelColor=0D1117)
&nbsp;![](https://img.shields.io/badge/Vercel_Serverless-white?style=for-the-badge&labelColor=0D1117&logo=vercel)

<br/>

<a href="#quickstart"><img src="https://img.shields.io/badge/🚀_Run_Locally-6366F1?style=for-the-badge&logoColor=white" alt="Run Locally"></a>&nbsp;
<a href="#vercel-web-deployment"><img src="https://img.shields.io/badge/▲_Deploy_to_Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Deploy to Vercel"></a>&nbsp;
<a href="#chrome-extension-setup"><img src="https://img.shields.io/badge/🧩_Load_Extension-38BDF8?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Load Chrome Extension"></a>&nbsp;
<a href="https://platform.decart.ai/api-keys"><img src="https://img.shields.io/badge/🔑_Decart_API_Key-10B981?style=for-the-badge&logoColor=white" alt="Decart API Key"></a>

</div>

---

## Contents

- [Why Atelier AI](#why-atelier-ai)
- [Architecture & Environments](#architecture--environments)
- [Quickstart (Local Backend)](#quickstart-local-backend)
- [Vercel Web Deployment](#vercel-web-deployment)
- [Chrome Extension Setup](#chrome-extension-setup)
- [Decart Platform API Key](#decart-platform-api-key)
- [Hardware & Model Fallbacks](#hardware--model-fallbacks)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Support & Sponsor](#support--sponsor)

---

## Why Atelier AI

- **👗 Universal Virtual Dressing Room** — Instantly preview garments on your live webcam or uploaded selfie with zero latency and natural collarbone alignment.
- **⚡ Dual Engine (Cloud + Edge)** — Connect your [Decart API Key](https://platform.decart.ai/api-keys) for cloud **Lucy VTON 3.5** generation, or run locally on your own GPU/CPU with PIL/PyTorch fallback.
- **🔒 True Client-Side Privacy** — Video frames are processed directly inside your browser canvas or on your local machine; raw video streams never leave your device unprompted.
- **🛍 E-Commerce Extension** — Seamlessly injects a "Try On" floating button on Zara, Revolve, UGG, Guess, Amazon, and fashion websites.
- **🚀 1-Click Vercel Ready** — Built-in serverless token minter (`/api/tokens`) and image proxy (`/api/proxy-image`) for zero-configuration web hosting.

---

## Architecture & Environments

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ATELIER AI STUDIO                               │
├──────────────────────┬───────────────────────────┬──────────────────────────┤
│   1. LOCAL SERVER    │   2. VERCEL WEB APP       │   3. CHROME EXTENSION    │
│   FastAPI / Uvicorn  │   Serverless API Routes   │   Manifest V3 Extension  │
│   Local GPU / CPU    │   Zero-setup cloud host   │   Injected e-commerce    │
│   Port: 7860         │   /api/tokens proxy       │   try-on mirror modal    │
└──────────┬───────────┴─────────────┬─────────────┴────────────┬─────────────┘
           │                         │                          │
           └─────────────────────────┼──────────────────────────┘
                                     ▼
                  ┌─────────────────────────────────────┐
                  │          DECART AI CLOUD            │
                  │   Model: lucy-vton-3.5              │
                  │   Signed JWT Client Sessions        │
                  │   https://api.decart.ai             │
                  └─────────────────────────────────────┘
```

---

## Repository Structure

```text
atelier-tryon/
├── api/                  # Vercel serverless API functions (/api/tokens, /api/proxy-image)
├── docs/                 # Engineering specs, filters, and architecture notes
├── extension/            # Chrome MV3 Extension (load this directory unpacked in Chrome)
│   ├── manifest.json     # MV3 extension manifest
│   ├── background.js     # Background service worker
│   ├── content.js        # E-commerce store detector & widget injector
│   ├── popup.html        # Decart API key settings & mirror launcher
│   ├── widget.html       # Virtual dressing room interface
│   ├── local-engine.js   # Real-time mirror & canvas rendering engine
│   └── icons/            # App icons (16, 32, 48, 128, 256, 512)
├── local-server/         # Local Python server (FastAPI, PyTorch GPU fallback, PIL composite)
│   ├── server.py         # Main daemon & WebSocket keyframe engine
│   ├── requirements.txt  # Python dependencies
│   └── start.bat         # 1-click Windows startup script
├── public/               # Static assets & garments served on Web and Local
│   ├── garments/         # Sample garment collection (PNG/SVG)
│   ├── logo.png          # Atelier luxury brand mark
│   └── favicon.ico       # Web & extension favicon
├── demo.html             # Full-screen virtual dressing studio
├── index.html            # Main web app landing page & showroom
├── vercel.json           # Vercel deployment routes & proxy rules
└── README.md             # Documentation, quickstart & architecture
```

---

## Quickstart (Local Backend)

### Prerequisites
- **Python 3.10+**
- Webcam (or photo upload)
- Windows 10/11, macOS, or Linux

### 1. Clone the repository
```bash
git clone https://github.com/jojin1709/atelier-tryon.git
cd atelier-tryon
```

### 2. Set up Python Virtual Environment
```bash
python -m venv .venv

# Windows:
.venv\Scripts\activate

# macOS / Linux:
source .venv/bin/activate
```

### 3. Install Requirements
```bash
pip install -r local-server/requirements.txt
```

### 4. Configure Decart API Key
Create or edit `local-server/.env`:
```env
DECART_API_KEY=dct_your_api_key_here
PORT=7860
```
*(Get your key from [platform.decart.ai/api-keys](https://platform.decart.ai/api-keys))*

### 5. Launch the Server
```bash
python -m uvicorn server:app --app-dir local-server --host 127.0.0.1 --port 7860
```

Open **`http://127.0.0.1:7860/demo`** in your browser!

---

## Vercel Web Deployment

Atelier includes pre-configured serverless functions (`/api/tokens.js`, `/api/proxy-image.js`) and `vercel.json` for instant deployment.

1. Push this repository to your GitHub.
2. Go to [Vercel Dashboard](https://vercel.com/new) and import `atelier-tryon`.
3. Set the Environment Variable:
   - `DECART_API_KEY`: your Decart API key.
4. Click **Deploy**. Anyone can visit the web URL and use their own Decart API key directly in the browser!

---

## Chrome Extension Setup

Try on garments while shopping online (Amazon, Zara, Revolve, Shein, etc.):

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top right.
3. Click **Load unpacked**.
4. Select the **`extension/`** folder inside the `atelier-tryon` repository.
5. Click the Atelier extension icon in your Chrome toolbar to enter your Decart API Key and launch your dressing room.

---

## Decart Platform API Key

Atelier natively authenticates with Decart's Lucy VTON 3.5 engine using signed client tokens:

1. Obtain your API key from [platform.decart.ai/api-keys](https://platform.decart.ai/api-keys).
2. Paste the key into:
   - The in-browser Settings modal (`⚙ Decart Cloud`).
   - The Chrome Extension popup settings.
   - Or your `local-server/.env` file.
3. The client mints ephemeral JWT tokens with `https://api.decart.ai/v1/client/tokens` to stream virtual try-on results securely.

---

## Hardware & Model Fallbacks

| Mode | Compute Tier | Latency | Requirement |
|---|---|---|---|
| **Decart Lucy VTON 3.5** | Decart Cloud | ~500ms | Decart API Key |
| **Local PyTorch / CatVTON** | CUDA / MPS / ROCm | 800ms - 2s | Dedicated GPU with 6GB+ VRAM |
| **High-Speed Composite** | On-Device CPU | < 16ms (60 FPS) | Any CPU (zero dependencies) |

---

## Roadmap

- [x] Decart Lucy VTON 3.5 signed client token integration.
- [x] Dual-mode Local Python FastAPI server with hardware fallback.
- [x] Vercel serverless deployment endpoints.
- [x] Chrome MV3 Extension with floating e-commerce try-on triggers.
- [x] Real-time 60 FPS mirror engine with natural chest & collarbone positioning.
- [x] Atelier luxury brand identity and vector asset suite.
- [ ] Multi-garment stacking (jackets over t-shirts).
- [ ] High-definition video recording & export.

---

## Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the Project (`https://github.com/jojin1709/atelier-tryon/fork`)
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## Support & Sponsor

Free and open-source. If this project helps you or your e-commerce workflow, please ⭐ **star the repo** — it helps others discover the studio!

<div align="center">

### ❤️ Sponsor jojin1709

<a href="https://github.com/sponsors/jojin1709"><img src="https://img.shields.io/badge/GitHub_Sponsors-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" height="32"></a>&nbsp;
<a href="https://github.com/sponsors/jojin1709"><img src="https://img.shields.io/badge/Become_a_Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Become a Sponsor"></a>

<br/>

<a href="https://github.com/jojin1709/atelier-tryon/stargazers"><img src="https://img.shields.io/badge/⭐_Star_Repository-6366F1?style=for-the-badge&logo=github&logoColor=white" alt="Star on GitHub"></a>

<br/><br/>

**Developed by JOJIN JOHN**

</div>
