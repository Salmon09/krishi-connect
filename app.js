/**
 * ==============================================================================
 * KRISHICONNECT UNIFIED JAVASCRIPT CORE ENGINE
 * ==============================================================================
 * Handles multi-page routing, local storage state transitions, 
 * secure Firebase integrations, file-to-base64 encoders, and 
 * Gemini VLM API call handshakes.
 * ==============================================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==============================================================================
// 1. GLOBAL STATE DEFINITIONS
// ==============================================================================
const PRODUCTION_BACKEND_URL = "https://krishiai-virtual-agronomist-portal.onrender.com";
let backendUrl = PRODUCTION_BACKEND_URL;
let ticketsList = [];
let userRole = 'farmer';
let chatHistory = [];
let db = null;
let auth = null;
let currentUser = null;
let isFallbackActive = false;

// Base64 storage of selected leaf photograph
let selectedBase64Image = null;
let selectedBase64MimeType = null;

const LOCAL_STORAGE_DB_KEY = "krishiconnect_portal_state_db";
const appId = typeof __app_id !== 'undefined' ? __app_id : 'krishiconnect-shared-portal';

// Predefined seed data to make the UI look beautiful instantly on startup
const DEFAULT_SEEDS = [
    {
        id: "seed-101",
        cropType: "Tomato",
        cropStage: "Flowering",
        region: "Pune, Maharashtra",
        symptoms: "Circular brown spots with yellow concentric margins resembling target boards on lower leaves.",
        createdAt: Date.now() - 3600 * 1000 * 3,
        status: "Awaiting Agronomist",
        farmerId: "seed-farmer",
        aiTriage: "AI TRIA_REPORT (Vision Core):\n- **Suspected Pathogen**: Early Blight (Alternaria solani).\n- **Threat Level**: HIGH\n- **Immediate Precautions**:\n  1. Prune and bag the infected foliage blocks immediately.\n  2. Avoid sprinkler irrigation; shift strictly to dry soil base watering to restrict spore splashing.",
        agronomistNote: "",
        imageUrl: "https://placehold.co/600x400/1e293b/a7f3d0?text=Tomato+Early+Blight+Concentric+Spots"
    },
    {
        id: "seed-102",
        cropType: "Rice",
        cropStage: "Vegetative",
        region: "Amritsar, Punjab",
        symptoms: "Powdery white spores spreading along margins of upper leaves. Spreading fast across neighbors.",
        createdAt: Date.now() - 3600 * 1000 * 20,
        status: "Resolved",
        farmerId: "seed-farmer",
        aiTriage: "AI TRIA_REPORT (Vision Core):\n- **Suspected Pathogen**: Powdery Mildew (Erysiphe complex).\n- **Threat Level**: MEDIUM\n- **Immediate Precautions**:\n  1. Increase plant spacing index to promote horizontal aeration.\n  2. Treat healthy crops preemptively with standard bio-neem extract solutions.",
        agronomistNote: "Verified powdery leaf coat parameters. Prescribed 80% water-soluble Sulphur formulation @ 2g per Liter of water during evening twilight.",
        agronomistId: "expert-pune-agri",
        imageUrl: "https://placehold.co/600x400/1e293b/a7f3d0?text=Rice+Powdery+White+Mildew+Marginal+Coat"
    }
];

// ==============================================================================
// 2. BOOTSTRAP SYSTEM HANDSHAKES & LOCAL STATE STORAGE
// ==============================================================================
window.addEventListener("DOMContentLoaded", async () => {
    loadLocalConfigurations();
    setupFileUploadListeners();
    await checkBackendIntegrity();
    window.switchPage('home');
    setupEventListeners();
});

function loadLocalConfigurations() {
    const savedUrl = localStorage.getItem("krishiconnect_custom_server_url");
    if (savedUrl) {
        backendUrl = savedUrl;
    } else {
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            backendUrl = "http://127.0.0.1:8000";
        } else {
            backendUrl = PRODUCTION_BACKEND_URL;
        }
    }

    // Sync database caches
    const savedDb = localStorage.getItem(LOCAL_STORAGE_DB_KEY);
    if (savedDb) {
        try {
            ticketsList = JSON.parse(savedDb);
        } catch(e) {
            ticketsList = [...DEFAULT_SEEDS];
        }
    } else {
        ticketsList = [...DEFAULT_SEEDS];
        saveStateToLocalStorage();
    }
}

function saveStateToLocalStorage() {
    localStorage.setItem(LOCAL_STORAGE_DB_KEY, JSON.stringify(ticketsList));
}

// Check if Python FastAPI server is active; if not, triggers clean sandbox emulation
async function checkBackendIntegrity() {
    const statusDot = document.getElementById("dbStatusDot");
    const statusText = document.getElementById("dbStatusText");

    let isFirebaseConfigAvailable = false;
    let parsedFirebaseConfig = null;
    try {
        if (typeof __firebase_config !== 'undefined' && __firebase_config) {
            parsedFirebaseConfig = JSON.parse(__firebase_config);
            isFirebaseConfigAvailable = true;
        }
    } catch (err) {}

    // Initialize Firebase if configs are available
    if (isFirebaseConfigAvailable && parsedFirebaseConfig) {
        try {
            const app = initializeApp(parsedFirebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);

            // Complete Authentication before any Firestore query
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(auth, __initial_auth_token);
            } else {
                await signInAnonymously(auth);
            }

            onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUser = user;
                    if (statusDot) statusDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
                    if (statusText) statusText.innerText = "CLOUD CORE ACTIVE";
                    subscribeToCloudTickets();
                } else {
                    activateSandboxFallback("AUTHENTICATION FAILURE");
                }
            });
            return;
        } catch (e) {
            console.warn("Could not handshake with Firebase cluster. Defaulting to local sandbox.", e);
        }
    }

    // Standard local check if Firebase config is unassigned
    try {
        const res = await fetch(`${backendUrl}/`);
        if (res.ok) {
            if (statusDot) statusDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
            if (statusText) statusText.innerText = "FASTAPI BACKEND CONNECTED";
        } else {
            throw new Error();
        }
    } catch(e) {
        activateSandboxFallback("MOCK CORE ACTIVE");
    }
    refreshUI();
}

function activateSandboxFallback(message) {
    isFallbackActive = true;
    const statusDot = document.getElementById("dbStatusDot");
    const statusText = document.getElementById("dbStatusText");
    if (statusDot) statusDot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
    if (statusText) statusText.innerText = message;
    refreshUI();
}

// Standard Firestore onSnapshot Stream Subscriber (RULE 2 Compliant)
function subscribeToCloudTickets() {
    if (isFallbackActive || !db) return;

    // Strict collection path matching rule 1
    const ticketsRef = collection(db, 'artifacts', appId, 'public', 'data', 'tickets');
    onSnapshot(ticketsRef, (snapshot) => {
        const list = [];
        snapshot.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });

        // Perform standard local in-memory chronological sorting (avoid indexing errors)
        list.sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
        ticketsList = list;
        refreshUI();
    }, (error) => {
        console.error("Cloud subscription disconnected. Retrying in fallback mode...", error);
        activateSandboxFallback("DATABASE RETRY FAIL");
    });
}

// ==============================================================================
// 3. FILE UPLOAD & PREVIEW LOGIC
// ==============================================================================
function setupFileUploadListeners() {
    const fileInput = document.getElementById("frmImageFile");
    const dropZone = document.getElementById("imageDropZone");
    if (!fileInput || !dropZone) return;

    fileInput.addEventListener("change", (e) => {
        handleFileSelection(e.target.files[0]);
    });

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.className = "border-2 border-dashed border-emerald-500 bg-emerald-950/20 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2 group";
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.className = "border-2 border-dashed border-slate-800 hover:border-emerald-600/80 bg-slate-950 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2 group relative";
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.className = "border-2 border-dashed border-slate-800 hover:border-emerald-600/80 bg-slate-950 rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center space-y-2 group relative";
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });
}

function handleFileSelection(file) {
    if (!file) return;

    // Reject files larger than 10MB
    if (file.size > 10 * 1024 * 1024) {
        alert("File size exceeds 10MB limit. Please upload a smaller crop image.");
        return;
    }

    const name = file.name;
    const sizeKB = (file.size / 1024).toFixed(1) + " KB";
    selectedBase64MimeType = file.type;

    const reader = new FileReader();
    reader.onload = function(event) {
        const base64Data = event.target.result.split(',')[1];
        selectedBase64Image = base64Data;

        // Apply previews to DOM elements
        const previewImg = document.getElementById("imagePreviewImg");
        const previewName = document.getElementById("imagePreviewName");
        const previewSize = document.getElementById("imagePreviewSize");
        const previewContainer = document.getElementById("imagePreviewContainer");

        if (previewImg) previewImg.src = event.target.result;
        if (previewName) {
            previewName.innerText = name;
            previewName.title = name;
        }
        if (previewSize) previewSize.innerText = sizeKB;
        if (previewContainer) previewContainer.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
}

window.clearSelectedImage = () => {
    const fileInput = document.getElementById("frmImageFile");
    if (fileInput) fileInput.value = "";
    selectedBase64Image = null;
    selectedBase64MimeType = null;
    const previewContainer = document.getElementById("imagePreviewContainer");
    if (previewContainer) previewContainer.classList.add("hidden");
};

// ==============================================================================
// 4. MULTI-PAGE NAVIGATION ROUTER (TAB WORKSPACE SWITCHER)
// ==============================================================================
window.switchPage = (pageName) => {
    const pages = ['home', 'farmer', 'agronomist', 'chat'];
    pages.forEach(p => {
        const pageEl = document.getElementById(`page${p.charAt(0).toUpperCase() + p.slice(1)}`);
        if (pageEl) pageEl.classList.add('hidden');
        
        // Reset navigation button borders
        const tabEl = document.getElementById(`tab${p.charAt(0).toUpperCase() + p.slice(1)}`);
        if (tabEl) {
            tabEl.className = "w-full px-4 py-3 text-sm font-bold text-slate-300 hover:text-white rounded-xl flex items-center space-x-3 transition bg-transparent hover:bg-slate-800 text-left border-none cursor-pointer";
        }
    });

    // Reveal active workspace page
    const activePage = document.getElementById(`page${pageName.charAt(0).toUpperCase() + pageName.slice(1)}`);
    if (activePage) activePage.classList.remove('hidden');

    // Assign emerald visual bg on chosen tab
    const activeTab = document.getElementById(`tab${pageName.charAt(0).toUpperCase() + pageName.slice(1)}`);
    if (activeTab) {
        if (pageName === 'agronomist') {
            activeTab.className = "w-full px-4 py-3 text-sm font-bold text-emerald-400 bg-slate-800 rounded-xl flex items-center justify-between transition text-left border-none cursor-pointer";
        } else {
            activeTab.className = "w-full px-4 py-3 text-sm font-bold text-white bg-slate-800 rounded-xl flex items-center space-x-3 transition text-left border-none cursor-pointer";
        }
    }
};

window.setUserRole = (role) => {
    userRole = role;
    const farmerBtn = document.getElementById("roleFarmerBtn");
    const agronomistBtn = document.getElementById("roleAgronomistBtn");
    const warningBox = document.getElementById("agronomistRoleWarning");

    if (role === 'farmer') {
        if (farmerBtn) farmerBtn.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 bg-white text-emerald-800 shadow-sm cursor-pointer";
        if (agronomistBtn) agronomistBtn.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 text-slate-300 hover:text-white border-none bg-transparent cursor-pointer";
        if (warningBox) warningBox.classList.remove("hidden");
    } else {
        if (agronomistBtn) agronomistBtn.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 bg-white text-emerald-800 shadow-sm cursor-pointer";
        if (farmerBtn) farmerBtn.className = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-1.5 text-slate-300 hover:text-white border-none bg-transparent cursor-pointer";
        if (warningBox) warningBox.classList.add("hidden");
    }
    refreshUI();
};

// ==============================================================================
// 5. FARMER SUBMISSIONS & MULTI-AGENT INFERENCE DISPATCHERS
// ==============================================================================
async function handleTicketSubmission(e) {
    e.preventDefault();
    const submitBtn = document.getElementById("frmSubmitBtn");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-1"></i> <span>Analyzing Visuals with Vision AI...</span>`;
    }

    const crop = document.getElementById("frmCropType").value;
    const stage = document.getElementById("frmCropStage").value;
    const region = document.getElementById("frmRegion").value;
    const symptoms = document.getElementById("frmSymptoms").value;

    let triageReport = "";
    let code = "BIOT-GEN-STRESS";

    try {
        const response = await fetch(`${backendUrl}/api/triage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                crop_type: crop,
                crop_stage: stage,
                region: region,
                symptoms: symptoms,
                image_base64: selectedBase64Image,
                image_mime: selectedBase64MimeType
            })
        });

        if (response.ok) {
            const data = await response.json();
            triageReport = data.ai_triage;
            code = data.diagnostic_code;
        } else {
            throw new Error();
        }
    } catch (err) {
        // Grounded offline sandbox fallback execution
        const symLower = symptoms.toLowerCase();
        if (symLower.includes("blight") || symLower.includes("spot")) {
            triageReport = "AI TRIA_REPORT (Sandbox Fallback Mode):\n- **Suspected Pathogen**: Fungal Pathological Compound (consistent with leaf spots).\n- **Threat Level**: HIGH\n- **Immediate Precautions**:\n  1. Isolate the affected block from surrounding clean foliage grids.\n  2. Avoid high moisture sprays during evenings to dry out active spores. Wait for final agronomist verification notes.";
            code = "SANDBOX-ALT-BLIGHT";
        } else if (symLower.includes("mildew") || symLower.includes("white")) {
            triageReport = "AI TRIA_REPORT (Sandbox Fallback Mode):\n- **Suspected Pathogen**: Powdery Mildew epidermal coat.\n- **Threat Level**: MEDIUM\n- **Immediate Precautions**:\n  1. Selectively prune dense canopy shoots to maximize lateral airflow.\n  2. Implement preventative spacing grids.";
            code = "SANDBOX-MILDEW";
        } else {
            triageReport = "AI TRIA_REPORT (Sandbox Fallback Mode):\n- **Suspected Issue**: Abiotic Stress / General localized nutrient stress.\n- **Threat Level**: LOW\n- **Immediate Precautions**:\n  1. Verify root aeration indexes before applying further moisture.\n  2. Perform localized soil pH balance checks.";
            code = "SANDBOX-GEN-STRESS";
        }
    }

    const item = {
        cropType: crop,
        cropStage: stage,
        region: region,
        symptoms: symptoms,
        createdAt: Date.now(),
        status: "Awaiting Agronomist",
        farmerId: currentUser ? currentUser.uid : "local-sandbox-farmer",
        aiTriage: triageReport,
        agronomistNote: "",
        agronomistId: "",
        imageUrl: selectedBase64Image ? `data:${selectedBase64MimeType};base64,${selectedBase64Image}` : null
    };

    if (isFallbackActive || !db) {
        item.id = "sandbox-" + Date.now();
        ticketsList.unshift(item);
        saveStateToLocalStorage();
        refreshUI();
    } else {
        try {
            const ref = collection(db, 'artifacts', appId, 'public', 'data', 'tickets');
            await addDoc(ref, item);
        } catch(e) {
            console.error("Failed to commit to cloud database. Appending to local storage cache.", e);
            item.id = "sandbox-" + Date.now();
            ticketsList.unshift(item);
            saveStateToLocalStorage();
            refreshUI();
        }
    }

    // Reset Form Elements
    const form = document.getElementById("ticketForm");
    if (form) form.reset();
    window.clearSelectedImage();
    
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> <span>Submit & Initiate AI Triage</span>`;
    }

    refreshUI();
    window.switchPage('farmer');
}

// ==============================================================================
// 6. AGRONOMIST REMEDIES & ACTIONS
// ==============================================================================
window.submitAgronomistPrescription = async (ticketId) => {
    const noteInput = document.getElementById(`prescNote-${ticketId}`);
    if (!noteInput || !noteInput.value.trim()) {
        alert("Please enter a custom prescription before submitting.");
        return;
    }

    const text = noteInput.value.trim();

    if (isFallbackActive || !db) {
        const index = ticketsList.findIndex(t => t.id === ticketId);
        if (index !== -1) {
            ticketsList[index].status = "Resolved";
            ticketsList[index].agronomistNote = text;
            ticketsList[index].agronomistId = "expert-certified-id";
            saveStateToLocalStorage();
            refreshUI();
            window.selectQueueTicket(ticketId); // Reload details panel view
        }
    } else {
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'tickets', ticketId);
            await updateDoc(docRef, {
                status: "Resolved",
                agronomistNote: text,
                agronomistId: currentUser ? currentUser.uid : "expert-cloud-id"
            });
            // Update local state to show instant reactive modifications
            const index = ticketsList.findIndex(t => t.id === ticketId);
            if (index !== -1) {
                ticketsList[index].status = "Resolved";
                ticketsList[index].agronomistNote = text;
                ticketsList[index].agronomistId = currentUser ? currentUser.uid : "expert-cloud-id";
            }
            refreshUI();
            window.selectQueueTicket(ticketId);
        } catch(e) {
            console.error("Cloud modification failed. Updating local backup caches.", e);
        }
    }
};

window.selectQueueTicket = (ticketId) => {
    const panel = document.getElementById("agriDetailsPanel");
    if (!panel) return;

    const t = ticketsList.find(item => item.id === ticketId);
    if (!t) return;

    const isAgronomist = userRole === 'agronomist';

    panel.innerHTML = `
        <div class="space-y-5 flex-grow overflow-y-auto max-h-[520px] pr-2 custom-scroll">
            <div class="flex justify-between items-start border-b border-slate-800 pb-3">
                <div>
                    <span class="text-xs font-mono text-slate-500">Farmer Account ID: ${t.farmerId.slice(0,8)}</span>
                    <h3 class="text-base font-black text-white mt-0.5">${t.cropType} Case File</h3>
                    <p class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider"><i class="fa-solid fa-location-dot mr-1"></i>${t.region}</p>
                </div>
                <span class="${t.status === 'Resolved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'} text-xs font-bold px-3.5 py-1 rounded-full">
                    ${t.status === 'Resolved' ? 'Resolved' : 'Needs Action'}
                </span>
            </div>

            <!-- Visual Leaf Evidence Display Container -->
            <div class="space-y-1.5">
                <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Visual Crop Evidence (Phytology Reference)</span>
                <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-center gap-4">
                    ${t.imageUrl 
                        ? `<a href="${t.imageUrl}" target="_blank" class="block w-full md:w-48 h-32 rounded-lg overflow-hidden border border-slate-800 bg-slate-990 group relative">
                             <img src="${t.imageUrl}" class="w-full h-full object-cover group-hover:scale-105 transition duration-200" alt="Leaf specimen image" onerror="this.src='https://placehold.co/300x200?text=Error+Loading+Image'"/>
                             <div class="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-xs text-white font-bold">
                                 <i class="fa-solid fa-expand mr-1.5"></i> Expand Specimen
                             </div>
                           </a>` 
                        : `<div class="w-full md:w-48 h-32 rounded-lg bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-600 space-y-1">
                             <i class="fa-solid fa-image-slash text-2xl"></i>
                             <span class="text-[10px] uppercase font-bold">No Specimen Uploaded</span>
                           </div>`
                    }
                    <div class="flex-grow space-y-1.5">
                        <p class="text-xs text-slate-400 font-bold">Specimen Variety details:</p>
                        <div class="grid grid-cols-2 gap-3 text-[11px] font-mono text-slate-300">
                            <p><span class="text-slate-500">Variety:</span> ${t.cropType}</p>
                            <p><span class="text-slate-500">Phenology:</span> ${t.cropStage}</p>
                            <p class="col-span-2"><span class="text-slate-500">Filed date:</span> ${new Date(t.createdAt).toLocaleDateString()} ${new Date(t.createdAt).toLocaleTimeString()}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="space-y-1">
                <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Farmer Symptoms Log</span>
                <div class="bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs text-slate-300 leading-relaxed font-serif">
                    "${t.symptoms}"
                </div>
            </div>

            <div class="space-y-1">
                <span class="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Generative AI Triage Pre-Diagnosis (Multimodal-Calibrated)</span>
                <div class="bg-emerald-950/30 border border-emerald-900/50 p-4 rounded-xl text-xs text-emerald-300 font-mono leading-relaxed whitespace-pre-wrap">
                    ${t.aiTriage}
                </div>
            </div>

            <div class="border-t border-slate-800 pt-4 space-y-2">
                <label class="block text-[10px] font-black text-emerald-400 uppercase tracking-wider">Expert Agronomist Prescription</label>
                ${t.status === 'Resolved'
                    ? `<div class="bg-emerald-950/40 border-l-4 border-emerald-500 p-4 rounded-r-xl text-xs text-slate-200 leading-relaxed font-serif italic">
                         "${t.agronomistNote}"
                       </div>`
                    : isAgronomist 
                        ? `<textarea id="prescNote-${t.id}" rows="3" placeholder="Enter custom prescription details, active compound metrics, biological treatment schemas..." class="w-full border border-slate-800 rounded-xl p-3 text-xs focus:outline-none focus:border-emerald-600 bg-slate-950 text-white" required></textarea>`
                        : `<div class="bg-amber-950/40 border border-amber-900/60 text-amber-300 p-3 rounded-xl text-xs flex items-center space-x-2">
                             <span>⚠️</span>
                             <span>Switch to **Agronomist** mode at the top right header to log prescriptions.</span>
                           </div>`
                }
            </div>
        </div>

        ${t.status === 'Resolved'
            ? `<div class="text-[10px] text-slate-500 font-mono text-center pt-4 border-t border-slate-800">Case resolved by certified expert ID [${t.agronomistId.slice(0,8)}]</div>`
            : isAgronomist
                ? `<div class="pt-4 border-t border-slate-800 flex justify-end">
                     <button onclick="window.submitAgronomistPrescription('${t.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase px-6 py-3 rounded-xl transition tracking-wide shadow-md border-none cursor-pointer">
                         Acknowledge & Save Expert Prescription
                     </button>
                   </div>`
                : ''
        }
    `;
};

// ==============================================================================
// 7. ADVISOR CHAT CONSOLE HANDLERS (GEMINI 2.5 FLASH OR EMBEDDED RETRIEVALS)
// ==============================================================================
async function handleChatSubmission(e) {
    e.preventDefault();
    const chatInput = document.getElementById("chatInput");
    if (!chatInput) return;

    const text = chatInput.value.trim();
    if (!text) return;

    appendChatBubble("user", text);
    chatInput.value = "";

    const placeholderId = appendChatBubble("bot", "Consulting digital agronomy knowledge base...");

    try {
        const response = await fetch(`${backendUrl}/api/triage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                crop_type: "General Chat",
                crop_stage: "Assessment",
                region: "Alluvial Flatlands",
                symptoms: text
            })
        });

        if (response.ok) {
            const data = await response.json();
            updateChatBubble(placeholderId, data.ai_triage);
            chatHistory.push({ role: "user", text: text });
            chatHistory.push({ role: "model", text: data.ai_triage });
        } else {
            throw new Error();
        }
    } catch(err) {
        // Dynamic client-side retrieval if backend API keys are absent
        let reply = "";
        const tLower = text.toLowerCase();
        if (tLower.includes("hello") || tLower.includes("hi")) {
            reply = "Hello! I am KrishiAI, your Virtual Agronomist. Describe your crops, symptoms, or soil profiles to initiate analysis.";
        } else if (tLower.includes("soil") || tLower.includes("fertilizer") || tLower.includes("nitrogen")) {
            reply = "Regarding soil management, maintaining balanced N-P-K macronutrient indexes is key:\n\n* **Nitrogen (N)**: Fuels vegetative growth. If leaves are turning pale yellow on lower layers, consider organic neem-cake compost or urea @ 2% solution.\n* **Phosphorus (P)**: Supports root density. Maintain soil pH between 6.0 and 7.0 for optimal absorption.\n* **Potassium (K)**: Increases crop disease resistance.";
        } else {
            reply = "Thank you for contacting KrishiAI! I am currently operating in localized standby mode.\n\n* For crop ailments: Describe leaf spots, patterns, and moisture conditions.\n* For fertilizer schedules: Specify crop variety and cultivation stages for optimal metrics.";
        }
        updateChatBubble(placeholderId, reply);
        chatHistory.push({ role: "user", text: text });
        chatHistory.push({ role: "model", text: reply });
    }
}

function appendChatBubble(sender, text) {
    const chatMessages = document.getElementById("chatMessages");
    if (!chatMessages) return "";

    const bubbleId = "msg-" + Date.now();
    const div = document.createElement("div");
    div.id = bubbleId;

    if (sender === "user") {
        div.className = "flex items-start space-x-3 max-w-[85%] ml-auto justify-end";
        div.innerHTML = `
            <div class="bg-emerald-700 text-white p-3 rounded-2xl text-xs leading-relaxed shadow-sm">
                ${text}
            </div>
            <div class="bg-slate-800 text-slate-300 p-2.5 rounded-xl text-xs"><i class="fa-solid fa-user"></i></div>
        `;
    } else {
        div.className = "flex items-start space-x-3 max-w-[85%]";
        div.innerHTML = `
            <div class="bg-emerald-950 text-emerald-400 p-2.5 rounded-xl text-xs flex-shrink-0"><i class="fa-solid fa-robot"></i></div>
            <div class="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl text-xs text-slate-200 leading-relaxed font-mono whitespace-pre-wrap">
                ${text}
            </div>
        `;
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubbleId;
}

function updateChatBubble(bubbleId, newText) {
    const el = document.getElementById(bubbleId);
    if (el) {
        const textBlock = el.querySelector(".font-mono");
        if (textBlock) {
            textBlock.innerText = newText;
        }
    }
    const chatMessages = document.getElementById("chatMessages");
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

window.clearChatHistory = () => {
    chatHistory = [];
    const chatMessages = document.getElementById("chatMessages");
    if (chatMessages) {
        chatMessages.innerHTML = `
            <div class="flex items-start space-x-3 max-w-[85%]">
                <div class="bg-emerald-950 text-emerald-400 p-2.5 rounded-xl text-xs"><i class="fa-solid fa-robot"></i></div>
                <div class="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl text-xs text-slate-200 leading-relaxed font-mono">
                    Console history cleared. Ask me any agronomy question regarding soil, diseases, dosages, or physical treatments.
                </div>
            </div>
        `;
    }
};

// ==============================================================================
// 8. DYNAMIC DOM RENDER REFRESH ENGINE
// ==============================================================================
function refreshUI() {
    // Page 1 Home Dashboard community log render
    const homeList = document.getElementById("homeTicketsList");
    const commCount = document.getElementById("commCount");
    if (commCount) commCount.innerText = `${ticketsList.length} Incident Records`;

    if (homeList) {
        if (ticketsList.length === 0) {
            homeList.innerHTML = `<div class="py-12 text-center text-slate-500 text-xs font-mono">No active community cases logged inside the portal yet.</div>`;
        } else {
            homeList.innerHTML = ticketsList.map(t => `
                <div class="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div class="flex items-start space-x-3">
                        ${t.imageUrl 
                            ? `<img src="${t.imageUrl}" class="w-12 h-12 rounded-lg object-cover border border-slate-800 bg-slate-950 flex-shrink-0" onerror="this.src='https://placehold.co/100x100?text=Crop'"/>` 
                            : `<div class="w-12 h-12 rounded-lg bg-emerald-950 text-emerald-400 flex items-center justify-center border border-slate-800 text-xs font-black flex-shrink-0">🌱</div>`
                        }
                        <div class="space-y-1 text-left">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-xs font-black text-white">${t.cropType}</span>
                                <span class="bg-slate-800 text-[9px] text-slate-400 px-2 py-0.5 rounded font-bold">${t.cropStage}</span>
                                <span class="text-[9px] text-slate-500 font-mono"><i class="fa-solid fa-location-dot mr-1"></i>${t.region}</span>
                            </div>
                            <p class="text-xs text-slate-400 max-w-xl truncate">${t.symptoms}</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2 flex-shrink-0">
                        ${t.status === "Resolved" 
                            ? `<span class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full"><i class="fa-solid fa-square-check"></i> RESOLVED</span>`
                            : `<span class="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-2.5 py-1 rounded-full animate-pulse"><i class="fa-solid fa-clock"></i> PENDING</span>`
                        }
                        <button onclick="window.viewTicketDetails('${t.id}')" class="text-xs font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1.5 rounded-lg transition border-none bg-transparent cursor-pointer">View</button>
                    </div>
                </div>
            `).join('');
        }
    }

    // Page 2 Farmer custom workspace list render
    const myCount = document.getElementById("myCount");
    if (myCount) myCount.innerText = `${ticketsList.length} Tickets`;

    const myTicketsList = document.getElementById("myTicketsList");
    if (myTicketsList) {
        if (ticketsList.length === 0) {
            myTicketsList.innerHTML = `<div class="text-center py-20 text-slate-500 text-xs font-mono">Waiting for your first crop incident report form input...</div>`;
        } else {
            myTicketsList.innerHTML = ticketsList.map(t => `
                <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3.5 shadow-sm hover:border-slate-700 transition">
                    <div class="flex justify-between items-start text-left">
                        <div class="flex items-start space-x-3">
                            ${t.imageUrl 
                                ? `<img src="${t.imageUrl}" class="w-12 h-12 rounded-lg object-cover border border-slate-800 bg-slate-950 flex-shrink-0" onerror="this.src='https://placehold.co/100x100?text=Crop'"/>` 
                                : `<div class="w-12 h-12 rounded-lg bg-emerald-950 text-emerald-400 flex items-center justify-center border border-slate-800 text-xs font-black flex-shrink-0">🌱</div>`
                            }
                            <div>
                                <span class="text-[9px] font-mono text-slate-500">${new Date(t.createdAt).toLocaleDateString()}</span>
                                <h4 class="font-extrabold text-xs text-white mt-1">${t.cropType} (${t.cropStage})</h4>
                                <p class="text-[9px] text-emerald-400 font-bold uppercase tracking-wider mt-0.5"><i class="fa-solid fa-location-dot mr-1"></i>${t.region}</p>
                            </div>
                        </div>
                        ${t.status === "Resolved" 
                            ? `<span class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold px-2 py-0.5 rounded-full"><i class="fa-solid fa-check"></i> Resolved</span>`
                            : `<span class="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full"><i class="fa-solid fa-hourglass-half"></i> Awaiting Expert</span>`
                        }
                    </div>

                    <div class="bg-slate-900 border border-slate-800 p-2.5 rounded-lg text-xs text-left">
                        <span class="block font-bold text-slate-500 uppercase tracking-widest text-[8px] mb-1">Farmer Symptom notes:</span>
                        <p class="text-slate-300">${t.symptoms}</p>
                    </div>

                    <div class="bg-emerald-950/40 border border-emerald-900/60 p-3.5 rounded-lg text-xs space-y-1.5 text-left">
                        <div class="flex items-center space-x-1.5 text-emerald-400 font-black text-[9px] uppercase tracking-wider">
                            <i class="fa-solid fa-robot"></i>
                            <span>Immediate AI Triage Analysis</span>
                        </div>
                        <p class="text-slate-300 font-mono leading-relaxed whitespace-pre-wrap text-[11px]">${t.aiTriage}</p>
                    </div>

                    ${t.status === "Resolved" 
                        ? `<div class="bg-slate-900 border-l-4 border-emerald-500 p-3.5 rounded-r-lg text-xs space-y-1 text-left">
                             <span class="block font-extrabold text-emerald-400 text-[9px] uppercase tracking-wider"><i class="fa-solid fa-stethoscope"></i> Verified Expert Prescription:</span>
                             <p class="text-slate-200 font-serif italic text-[13px] leading-relaxed">"${t.agronomistNote}"</p>
                           </div>`
                        : `<div class="bg-slate-900/40 border border-slate-800/80 p-2.5 rounded-lg text-xs text-slate-500 flex items-center space-x-2 text-left">
                             <span>ℹ️</span>
                             <span>The agronomist team has been notified. Apply the AI triage guidelines as a temporary measure.</span>
                           </div>`
                    }
                </div>
            `).join('');
        }
    }

    // Page 3 Agronomist inbound Queue list render
    const queueList = document.getElementById("agriQueueList");
    if (queueList) {
        if (ticketsList.length === 0) {
            queueList.innerHTML = `<div class="text-center py-20 text-slate-500 text-xs">Queue is currently empty.</div>`;
        } else {
            queueList.innerHTML = ticketsList.map(t => `
                <div onclick="window.selectQueueTicket('${t.id}')" class="bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl p-3.5 cursor-pointer transition shadow-sm hover:border-slate-700 flex items-center space-x-3 text-left">
                    ${t.imageUrl 
                        ? `<img src="${t.imageUrl}" class="w-12 h-12 rounded-lg object-cover border border-slate-800 bg-slate-950 flex-shrink-0" onerror="this.src='https://placehold.co/100x100?text=Crop'"/>` 
                        : `<div class="w-12 h-12 rounded-lg bg-emerald-950 text-emerald-400 flex items-center justify-center border border-slate-800 text-xs font-black flex-shrink-0">🌱</div>`
                    }
                    <div class="flex-grow min-w-0">
                        <div class="flex justify-between items-center">
                            <span class="text-[9px] font-mono text-slate-500">TICKET #${t.id.slice(0,6)}</span>
                            <span class="${t.status === 'Resolved' ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'} text-[8px] font-bold px-1.5 py-0.5 rounded">
                                ${t.status === 'Resolved' ? 'RESOLVED' : 'AWAITING'}
                            </span>
                        </div>
                        <h4 class="font-bold text-xs text-white truncate mt-0.5">${t.cropType} (${t.cropStage})</h4>
                        <p class="text-[9px] text-slate-400 truncate mt-0.5">${t.symptoms}</p>
                    </div>
                </div>
            `).join('');
        }
    }
}

window.viewTicketDetails = (ticketId) => {
    window.switchPage('farmer');
    const el = document.getElementById("myTicketsList");
    if (el) el.scrollIntoView({ behavior: 'smooth' });
};

// ==============================================================================
// 9. EVENT LISTENERS HANDSHAKE
// ==============================================================================
function setupEventListeners() {
    const tForm = document.getElementById("ticketForm");
    if (tForm) tForm.addEventListener("submit", handleTicketSubmission);

    const cForm = document.getElementById("chatForm");
    if (cForm) cForm.addEventListener("submit", handleChatSubmission);
}